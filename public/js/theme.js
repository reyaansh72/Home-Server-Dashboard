(() => {
    const root = document.documentElement;
    const fallbackSurface = [50, 50, 51];
    const fallbackAccent = [200, 215, 184];
    const fallbackBackground = '/assets/Mountain.jpg';
    const backgroundsByDaypart = {
        morning: '/assets/morning.png',
        day: '/assets/day.png',
        evening: '/assets/evening.png',
        night: '/assets/night.png'
    };
    const mixColors = (first, second, amount) => first.map((channel, index) => channel * (1 - amount) + second[index] * amount);
    let activeDaypart = null;
    let fixedDaypart = null;
    let themeReady = false;

    const luminance = ([red, green, blue]) => (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
    const rgbValue = (color) => color.map((channel) => Math.round(channel)).join(' ');

    function setTheme(averageColor) {
        const surfaceColor = averageColor
            ? averageColor.map((channel, index) => fallbackSurface[index] * 0.68 + channel * 0.32)
            : fallbackSurface;
        const imageLuminance = averageColor ? luminance(averageColor) : 120;
        const accentColor = averageColor
            ? averageColor.map((channel, index) => (255 - channel) * 0.42 + fallbackAccent[index] * 0.58)
            : fallbackAccent;
        const coolAccent = mixColors(accentColor, [111, 190, 197], 0.34);
        const warmAccent = mixColors(accentColor, [225, 178, 107], 0.34);
        const softAccent = mixColors(accentColor, [190, 155, 201], 0.34);
        const accentLuminance = luminance(accentColor);
        const accentContrast = accentLuminance > 165 ? [38, 40, 35] : [255, 255, 255];
        const backgroundInk = imageLuminance > 155 ? [50, 50, 51] : [214, 214, 211];

        root.style.setProperty('--theme-surface-rgb', rgbValue(surfaceColor));
        root.style.setProperty('--theme-accent-rgb', rgbValue(accentColor));
        root.style.setProperty('--theme-cool-rgb', rgbValue(coolAccent));
        root.style.setProperty('--theme-warm-rgb', rgbValue(warmAccent));
        root.style.setProperty('--theme-soft-rgb', rgbValue(softAccent));
        root.style.setProperty('--theme-accent-ink-rgb', rgbValue(accentContrast));
        root.style.setProperty('--theme-background-ink-rgb', rgbValue(backgroundInk));
        root.style.setProperty('--theme-logo-filter', imageLuminance > 155 ? 'none' : 'brightness(0) invert(.84)');
        root.style.setProperty('--theme-surface-alpha', imageLuminance > 190 ? '.84' : '.8');
    }

    function sampleImage(source, fallbackOnError = true) {
        let backgroundUrl;
        try {
            backgroundUrl = new URL(source, document.baseURI);
            backgroundUrl.searchParams.set('theme-refresh', Date.now().toString());
        } catch {
            setTheme(null);
            return;
        }

        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            root.style.setProperty('--dashboard-background', `url("${backgroundUrl.href}")`);
            const canvas = document.createElement('canvas');
            const size = 40;
            canvas.width = size;
            canvas.height = size;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) {
                setTheme(null);
                return;
            }

            const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
            const width = image.naturalWidth * scale;
            const height = image.naturalHeight * scale;
            context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);

            try {
                const pixels = context.getImageData(0, 0, size, size).data;
                const totals = [0, 0, 0];
                let samples = 0;
                for (let index = 0; index < pixels.length; index += 4) {
                    const opacity = pixels[index + 3] / 255;
                    totals[0] += pixels[index] * opacity + 255 * (1 - opacity);
                    totals[1] += pixels[index + 1] * opacity + 255 * (1 - opacity);
                    totals[2] += pixels[index + 2] * opacity + 255 * (1 - opacity);
                    samples += 1;
                }
                setTheme(samples ? totals.map((channel) => channel / samples) : null);
            } catch {
                setTheme(null);
            }
        };
        image.onerror = () => {
            if (fallbackOnError && !backgroundUrl.pathname.endsWith('/Mountain.jpg')) {
                sampleImage(fallbackBackground, false);
            } else {
                root.style.setProperty('--dashboard-background', `url("${fallbackBackground}")`);
                setTheme(null);
            }
        };
        image.src = backgroundUrl.href;
    }

    function getDaypart(date = new Date()) {
        const hour = date.getHours();
        if (hour >= 5 && hour < 11) return 'morning';
        if (hour >= 11 && hour < 17) return 'day';
        if (hour >= 17 && hour < 21) return 'evening';
        return 'night';
    }

    function updateDaypart() {
        if (!themeReady) return;
        const now = new Date();
        const daypart = fixedDaypart || getDaypart(now);
        const label = document.getElementById('daypart-label');
        const icon = document.getElementById('daypart-icon');
        const clock = document.getElementById('daypart-clock');
        const icons = { morning: 'wb_twilight', day: 'light_mode', evening: 'wb_twilight', night: 'dark_mode' };

        if (label) label.textContent = daypart[0].toUpperCase() + daypart.slice(1);
        if (icon) icon.textContent = icons[daypart];
        if (clock) clock.textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now);
        document.documentElement.dataset.daypart = daypart;

        if (daypart !== activeDaypart) {
            activeDaypart = daypart;
            sampleImage(backgroundsByDaypart[daypart]);
            window.dispatchEvent(new CustomEvent('dashboard-daypart-change', { detail: { daypart, time: now } }));
        }
    }

    function sampleBackground() {
        const background = getComputedStyle(document.body).backgroundImage;
        const match = background.match(/url\(["']?(.*?)["']?\)/);
        sampleImage(match ? match[1] : fallbackBackground);
    }

    window.refreshDashboardTheme = () => {
        activeDaypart = null;
        updateDaypart();
    };
    window.getDashboardDaypart = (date) => fixedDaypart || getDaypart(date);
    window.addEventListener('dashboard-background-change', sampleBackground);

    async function initializeTheme() {
        try {
            const response = await fetch('/api/theme', { cache: 'no-store' });
            if (response.ok) {
                const settings = await response.json();
                if (['morning', 'day', 'evening', 'night'].includes(settings.daypart)) fixedDaypart = settings.daypart;
            }
        } catch {
            fixedDaypart = null;
        }
        themeReady = true;
        updateDaypart();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeTheme, { once: true });
    } else {
        initializeTheme();
    }
    window.setInterval(updateDaypart, 15000);
})();
