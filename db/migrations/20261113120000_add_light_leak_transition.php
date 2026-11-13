<?php
/** @phpcs:disable PSR1.Classes.ClassDeclaration.MissingNamespace */
use Phinx\Migration\AbstractMigration;

class AddLightLeakTransition extends AbstractMigration
{
    public function up(): void
    {
        // Preserve administrator choices if the catalog entry already exists.
        if (!$this->fetchRow("SELECT transitionId FROM transition WHERE code = 'lightLeak'")) {
            $this->table('transition')->insert([
                'transition' => 'Light Leak (Photos)',
                'code' => 'lightLeak',
                'hasDuration' => 1,
                'hasDirection' => 0,
                'availableAsIn' => 1,
                'availableAsOut' => 0,
            ])->saveData();
        }
    }

    public function down(): void
    {
        // Clear the custom code so layouts remain playable after rollback.
        $this->execute("DELETE FROM widgetoption WHERE option IN ('transIn', 'transOut') AND value = 'lightLeak'");
        $this->execute("DELETE FROM transition WHERE code = 'lightLeak'");
    }
}
