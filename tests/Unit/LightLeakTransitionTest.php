<?php
namespace Xibo\Tests\Unit;

use Phinx\Db\Adapter\SQLiteAdapter;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Console\Output\NullOutput;
use Xibo\Helper\LightLeakTransition;
use Xibo\Support\Exception\InvalidArgumentException;

class LightLeakTransitionTest extends TestCase
{
    public function testDefaultsAndCustomDuration(): void
    {
        $this->assertSame(1800, LightLeakTransition::validate('image', 'in', null));
        $this->assertSame(2300, LightLeakTransition::validate('image', 'in', 2300));
        $this->assertSame(100, LightLeakTransition::validate('image', 'in', 100));
        $this->assertSame(10000, LightLeakTransition::validate('image', 'in', 10000));
    }

    public function testRejectsIncompatibleWidgetsAndDurations(): void
    {
        foreach ([['video', 'in', 1800], ['image', 'out', 1800], ['image', 'in', 0],
            ['image', 'in', -1], ['image', 'in', 99], ['image', 'in', 10001]] as $values) {
            try {
                LightLeakTransition::validate(...$values);
                $this->fail('Invalid transition accepted');
            } catch (InvalidArgumentException $exception) {
                $this->assertNotEmpty($exception->getMessage());
            }
        }
    }

    public function testCatalogMigrationIsRepeatableAndRollbackPreservesOtherTransitions(): void
    {
        require_once dirname(__DIR__, 2) . '/db/migrations/20261113120000_add_light_leak_transition.php';
        $adapter = new SQLiteAdapter(['name' => ':memory:'], null, new NullOutput());
        $adapter->connect();
        $adapter->execute('CREATE TABLE transition (transitionId INTEGER PRIMARY KEY, transition TEXT, code TEXT, hasDuration INTEGER, hasDirection INTEGER, availableAsIn INTEGER, availableAsOut INTEGER)');
        $adapter->execute('CREATE TABLE widgetoption (widgetId INTEGER, option TEXT, value TEXT)');
        $adapter->execute("INSERT INTO transition VALUES (1, 'Fade In', 'fadeIn', 1, 0, 1, 0)");
        $migration = new \AddLightLeakTransition('test', 20261113120000);
        $migration->setAdapter($adapter);
        $migration->up();
        $entry = $adapter->fetchRow("SELECT * FROM transition WHERE code = 'lightLeak'");
        $this->assertSame('Light Leak (Photos)', $entry['transition']);
        $this->assertEquals(1, $entry['availableAsIn']);
        $this->assertEquals(0, $entry['availableAsOut']);
        $this->assertEquals(1, $entry['hasDuration']);
        $this->assertEquals(0, $entry['hasDirection']);
        $adapter->execute("UPDATE transition SET availableAsIn = 0 WHERE code = 'lightLeak'");
        $migration->up();
        $this->assertCount(2, $adapter->fetchAll('SELECT * FROM transition'));
        $this->assertEquals(0, $adapter->fetchRow("SELECT * FROM transition WHERE code = 'lightLeak'")['availableAsIn']);
        $adapter->execute("INSERT INTO widgetoption VALUES (1, 'transIn', 'lightLeak'), (1, 'transInDuration', '1800'), (2, 'transIn', 'fadeIn')");
        $migration->down();
        $this->assertSame('fadeIn', $adapter->fetchRow('SELECT * FROM transition')['code']);
        $this->assertCount(2, $adapter->fetchAll('SELECT * FROM widgetoption'));
        $this->assertSame('fadeIn', $adapter->fetchRow('SELECT * FROM widgetoption WHERE widgetId = 2')['value']);
        $adapter->disconnect();
    }
}
