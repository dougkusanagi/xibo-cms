<?php
namespace Xibo\Tests\Unit;

use PHPUnit\Framework\TestCase;
use Slim\Http\ServerRequest;
use Slim\Http\Response;
use Xibo\Controller\Widget as WidgetController;
use Xibo\Entity\Widget;
use Xibo\Entity\WidgetOption;
use Xibo\Entity\Playlist;
use Xibo\Entity\User;
use Xibo\Factory\WidgetFactory;
use Xibo\Factory\WidgetOptionFactory;
use Xibo\Factory\PlaylistFactory;
use Xibo\Helper\ApplicationState;
use Xibo\Service\LogServiceInterface;
use Xibo\Support\Sanitizer\RespectSanitizer;

class LightLeakWidgetControllerTest extends TestCase
{
    public function testApiStoresDefaultAndCustomDurationAsRealWidgetOptions(): void
    {
        foreach ([null, 2300] as $duration) {
            $log = $this->createMock(LogServiceInterface::class);
            $options = $this->createMock(WidgetOptionFactory::class);
            $options->method('create')->willReturnCallback(function ($id, $type, $name, $value) use ($log) {
                $option = new WidgetOption(null, $log, null);
                $option->widgetId = $id; $option->type = $type; $option->option = $name; $option->value = $value;
                return $option;
            });
            $widget = $this->getMockBuilder(Widget::class)->setConstructorArgs([
                null, $log, null, $options, null, null, null, null, null,
            ])->onlyMethods(['load', 'save'])->getMock();
            $widget->widgetId = 22; $widget->playlistId = 11; $widget->type = 'image';
            $widget->expects($this->once())->method('save');
            $factory = $this->createMock(WidgetFactory::class);
            $factory->method('getById')->willReturn($widget);
            $playlist = $this->getMockBuilder(Playlist::class)->disableOriginalConstructor()->onlyMethods(['isEditable'])->getMock();
            $playlist->method('isEditable')->willReturn(true); $playlist->isDynamic = 0;
            $playlists = $this->createMock(PlaylistFactory::class);
            $playlists->method('getById')->willReturn($playlist);
            $user = $this->getMockBuilder(User::class)->disableOriginalConstructor()->onlyMethods(['checkEditable'])->getMock();
            $user->method('checkEditable')->willReturn(true);
            $controller = $this->getMockBuilder(WidgetController::class)->disableOriginalConstructor()
                ->onlyMethods(['getUser', 'getSanitizer', 'getState', 'render'])->getMock();
            $controller->method('getUser')->willReturn($user);
            $controller->method('getState')->willReturn(new ApplicationState());
            $controller->method('getSanitizer')->willReturnCallback(fn ($values) => (new RespectSanitizer())->setCollection($values));
            foreach (['widgetFactory' => $factory, 'playlistFactory' => $playlists] as $name => $value) {
                (new \ReflectionProperty(WidgetController::class, $name))->setValue($controller, $value);
            }
            $values = ['transitionType' => 'lightLeak'];
            if ($duration !== null) $values['transitionDuration'] = $duration;
            $request = $this->getMockBuilder(ServerRequest::class)->disableOriginalConstructor()->onlyMethods(['getParams'])->getMock();
            $request->method('getParams')->willReturn($values);
            $response = $this->getMockBuilder(Response::class)->disableOriginalConstructor()->getMock();
            $controller->method('render')->willReturn($response);
            $controller->editWidgetTransition($request, $response, 'in', 22);
            $this->assertSame('lightLeak', $widget->getOptionValue('transIn', null));
            $this->assertSame($duration ?? 1800, $widget->getOptionValue('transInDuration', null));
        }
    }

    public function testFormOffersLightLeakOnlyForPhotos(): void
    {
        foreach (['image', 'video'] as $type) {
            $widget = $this->getMockBuilder(Widget::class)->disableOriginalConstructor()->getMock();
            $widget->type = $type;
            $widgets = $this->createMock(WidgetFactory::class);
            $widgets->method('loadByWidgetId')->willReturn($widget);
            $modules = $this->createMock(\Xibo\Factory\ModuleFactory::class);
            $modules->method('getByType')->willReturn($this->createMock(\Xibo\Entity\Module::class));
            $transitions = $this->createMock(\Xibo\Factory\TransitionFactory::class);
            $transitions->method('getEnabledByType')->willReturnCallback(fn ($direction) => $direction === 'in'
                ? [(object) ['code' => 'fadeIn'], (object) ['code' => 'lightLeak']] : [(object) ['code' => 'fadeOut']]);
            $user = $this->getMockBuilder(User::class)->disableOriginalConstructor()->onlyMethods(['checkEditable'])->getMock();
            $user->method('checkEditable')->willReturn(true);
            $state = new ApplicationState();
            $controller = $this->getMockBuilder(WidgetController::class)->disableOriginalConstructor()
                ->onlyMethods(['getUser', 'getState', 'render'])->getMock();
            $controller->method('getUser')->willReturn($user);
            $controller->method('getState')->willReturn($state);
            foreach (['widgetFactory' => $widgets, 'moduleFactory' => $modules, 'transitionFactory' => $transitions] as $name => $value) {
                (new \ReflectionProperty(WidgetController::class, $name))->setValue($controller, $value);
            }
            $request = $this->getMockBuilder(ServerRequest::class)->disableOriginalConstructor()->getMock();
            $response = $this->getMockBuilder(Response::class)->disableOriginalConstructor()->getMock();
            $controller->method('render')->willReturn($response);
            $controller->editWidgetTransitionForm($request, $response, 'in', 22);
            $codes = array_column($state->getData()['transitions']['in'], 'code');
            $this->assertSame($type === 'image' ? ['fadeIn', 'lightLeak'] : ['fadeIn'], $codes);
            $this->assertSame('module-form-transition', $state->template);
        }
    }

}
