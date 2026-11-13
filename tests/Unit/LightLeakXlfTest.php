<?php
namespace Xibo\Tests\Unit;

use PHPUnit\Framework\TestCase;
use Symfony\Component\EventDispatcher\EventDispatcher;
use Xibo\Entity\Layout;
use Xibo\Entity\Module;
use Xibo\Entity\Playlist;
use Xibo\Entity\Region;
use Xibo\Entity\Widget;
use Xibo\Entity\WidgetOption;
use Xibo\Factory\ModuleFactory;
use Xibo\Factory\WidgetOptionFactory;
use Xibo\Service\ConfigServiceInterface;
use Xibo\Service\LogServiceInterface;

/** Exercises the real option storage and Layout::toXlf, without a CMS database. */
class LightLeakXlfTest extends TestCase
{
    private function inject(object $object, string $class, string $name, mixed $value): void
    {
        (new \ReflectionProperty($class, $name))->setValue($object, $value);
    }

    public function testRealWidgetOptionsReachTheExportedXlfWithoutChangingPlaybackDuration(): void
    {
        $log = $this->createMock(LogServiceInterface::class);
        $dispatcher = new EventDispatcher();
        $optionFactory = $this->createMock(WidgetOptionFactory::class);
        $optionFactory->method('create')->willReturnCallback(function ($id, $type, $name, $value) use ($log, $dispatcher) {
            $option = new WidgetOption(null, $log, $dispatcher);
            $option->widgetId = $id; $option->type = $type; $option->option = $name; $option->value = $value;
            return $option;
        });
        $widgets = [];
        foreach ([1, 2] as $id) {
            $widget = new Widget(null, $log, $dispatcher, $optionFactory, null, null, null, null, null);
            $widget->widgetId = $id;
            $widget->type = 'image';
            $widget->useDuration = 1;
            $widget->duration = $widget->calculatedDuration = 60;
            $widget->schemaVersion = 4;
            $widget->setOptionValue('transIn', 'attrib', 'lightLeak');
            $widget->setOptionValue('transInDuration', 'attrib', $id === 1 ? 1800 : 2300);
            $this->assertSame('lightLeak', $widget->getOptionValue('transIn', null));
            $widgets[] = $widget;
        }
        $playlist = $this->getMockBuilder(Playlist::class)->disableOriginalConstructor()
            ->onlyMethods(['setModuleFactory', 'expandWidgets'])->getMock();
        $playlist->method('setModuleFactory')->willReturnSelf();
        $playlist->method('expandWidgets')->willReturn($widgets);
        $region = $this->getMockBuilder(Region::class)->disableOriginalConstructor()->onlyMethods(['getPlaylist', 'getOptionValue'])->getMock();
        $region->method('getPlaylist')->willReturn($playlist);
        $region->method('getOptionValue')->willReturnCallback(fn ($name, $default) => $default);
        $region->regionId = 1; $region->width = 1280; $region->height = 720;
        $region->top = $region->left = $region->zIndex = $region->isDrawer = 0;
        $module = $this->getMockBuilder(Module::class)->disableOriginalConstructor()->onlyMethods(['decorateProperties'])->getMock();
        $module->method('decorateProperties')->willReturnSelf();
        // The URI property is supplied here instead of invoking MediaFactory/database.
        $module->regionSpecific = 1;
        $module->properties = [];
        $moduleFactory = $this->createMock(ModuleFactory::class);
        $moduleFactory->method('getByType')->willReturn($module);
        $config = $this->createMock(ConfigServiceInterface::class);
        $config->method('getSetting')->willReturnCallback(fn ($name) => $name === 'WIDGET_STATS_ENABLED_DEFAULT' ? 'Off' : 0);
        $layout = $this->getMockBuilder(Layout::class)->disableOriginalConstructor()
            ->onlyMethods(['load', 'assessWidgetStatus'])->getMock();
        $this->inject($layout, Layout::class, 'log', $log);
        $this->inject($layout, Layout::class, 'dispatcher', $dispatcher);
        $this->inject($layout, Layout::class, 'config', $config);
        $this->inject($layout, Layout::class, 'moduleFactory', $moduleFactory);
        $layout->layoutId = 101; $layout->layout = 'Light Leak fixture';
        $layout->width = 1280; $layout->height = 720; $layout->schemaVersion = 4;
        $layout->backgroundColor = '#131313';
        $layout->backgroundImageId = $layout->backgroundzIndex = $layout->enableStat = 0;
        $layout->autoApplyTransitions = 0;
        $layout->regions = [$region]; $layout->drawers = [];
        $xml = $layout->toXlf();
        $document = new \DOMDocument(); $document->loadXML($xml);
        $xpath = new \DOMXPath($document);
        $this->assertSame('lightLeak', $xpath->evaluate('string(/layout/region/media[@id="2"]/options/transIn)'));
        $this->assertSame('1800', $xpath->evaluate('string(/layout/region/media[@id="1"]/options/transInDuration)'));
        $this->assertSame('2300', $xpath->evaluate('string(/layout/region/media[@id="2"]/options/transInDuration)'));
        $this->assertSame('60', $xpath->evaluate('string(/layout/region/media[@id="2"]/@duration)'));
        $this->assertEquals(120, $layout->duration);
    }
}
