<?php
namespace Xibo\Helper;

use Xibo\Support\Exception\InvalidArgumentException;

/** Options shared by the widget form/API and XLF playback. */
class LightLeakTransition
{
    public const CODE = 'lightLeak';
    public const DEFAULT_DURATION = 1800;

    public static function validate(string $widgetType, string $type, ?int $duration): int
    {
        if ($widgetType !== 'image' || $type !== 'in') {
            throw new InvalidArgumentException(__('Light Leak is an entry transition for photos.'), 'transitionType');
        }
        $duration ??= self::DEFAULT_DURATION;
        if ($duration < 100 || $duration > 10000) {
            throw new InvalidArgumentException(__('Light Leak duration must be between 100 and 10000 milliseconds.'), 'transitionDuration');
        }
        return $duration;
    }
}
