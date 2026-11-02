const citySearchForm = document.getElementById('city-search-form');
const citySearchInput = document.getElementById('city-search');
const weatherStatus = document.getElementById('weather-status');
const savedCityKey = 'homeServer.weather.city';

const weatherCodes = {
    0: ['Clear sky', 'sunny'],
    1: ['Mainly clear', 'partly_cloudy_day'],
    2: ['Partly cloudy', 'partly_cloudy_day'],
    3: ['Overcast', 'cloud'],
    45: ['Fog', 'foggy'],
    48: ['Rime fog', 'foggy'],
    51: ['Light drizzle', 'rainy'],
    53: ['Drizzle', 'rainy'],
    55: ['Heavy drizzle', 'rainy'],
    56: ['Freezing drizzle', 'weather_mix'],
    57: ['Heavy freezing drizzle', 'weather_mix'],
    61: ['Light rain', 'rainy'],
    63: ['Rain', 'rainy'],
    65: ['Heavy rain', 'rainy'],
    66: ['Freezing rain', 'weather_mix'],
    67: ['Heavy freezing rain', 'weather_mix'],
    71: ['Light snow', 'cloudy_snowing'],
    73: ['Snow', 'cloudy_snowing'],
    75: ['Heavy snow', 'snowing_heavy'],
    77: ['Snow grains', 'cloudy_snowing'],
    80: ['Rain showers', 'rainy'],
    81: ['Rain showers', 'rainy'],
    82: ['Heavy showers', 'rainy'],
    85: ['Snow showers', 'cloudy_snowing'],
    86: ['Heavy snow showers', 'snowing_heavy'],
    95: ['Thunderstorm', 'thunderstorm'],
    96: ['Thunderstorm with hail', 'thunderstorm'],
    99: ['Heavy thunderstorm', 'thunderstorm']
};

function conditionFor(code) {
    return weatherCodes[code] || ['Conditions unavailable', 'cloud'];
}

function setStatus(message, state = '') {
    weatherStatus.textContent = message;
    weatherStatus.dataset.state = state;
}

function placeName(city) {
    return [city.name, city.admin1, city.country].filter((part, index, list) => part && list.indexOf(part) === index).join(', ');
}

function localDayLabel(dateString, index) {
    if (index === 0) return 'Today';
    if (index === 1) return 'Tomorrow';
    const [year, month, day] = dateString.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function renderCurrent(city, forecast) {
    const current = forecast.current;
    const todayIndex = forecast.daily.time.indexOf(current.time.slice(0, 10));
    const today = Math.max(0, todayIndex);
    const [description, icon] = conditionFor(current.weather_code);
    document.getElementById('current-city').textContent = placeName(city);
    document.getElementById('current-date').textContent = new Intl.DateTimeFormat(undefined, {
        weekday: 'long', month: 'long', day: 'numeric'
    }).format(new Date(`${current.time.slice(0, 10)}T12:00:00Z`));
    document.getElementById('current-icon').textContent = icon;
    document.getElementById('current-temperature').textContent = Math.round(current.temperature_2m);
    document.getElementById('current-description').textContent = description;
    document.getElementById('feels-like').textContent = `Feels like ${Math.round(current.apparent_temperature)}°`;
    document.getElementById('current-humidity').textContent = `${current.relative_humidity_2m}%`;
    document.getElementById('current-wind').textContent = `${Math.round(current.wind_speed_10m)} km/h`;
    document.getElementById('current-uv').textContent = forecast.daily.uv_index_max[today]?.toFixed(1) ?? '--';
    document.getElementById('current-rain').textContent = `${forecast.daily.precipitation_probability_max[today] ?? 0}%`;
    document.getElementById('forecast-timezone').textContent = forecast.timezone_abbreviation || forecast.timezone;
    document.getElementById('weather-updated').textContent = `Updated ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date())}`;
}

function renderHourly(forecast) {
    const hourly = forecast.hourly;
    let start = hourly.time.findIndex((time) => time >= forecast.current.time.slice(0, 13));
    if (start < 0) start = 0;
    const slots = hourly.time.slice(start, start + 8);
    document.getElementById('hourly-forecast').replaceChildren(...slots.map((time, offset) => {
        const index = start + offset;
        const [description, icon] = conditionFor(hourly.weather_code[index]);
        const item = document.createElement('article');
        item.className = 'hourly-item';
        item.setAttribute('aria-label', `${time.slice(11, 16)}, ${description}, ${Math.round(hourly.temperature_2m[index])} degrees`);
        const label = index === start ? 'Now' : new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' }).format(new Date(`1970-01-01T${time.slice(11, 16)}:00Z`));
        item.innerHTML = `<span class="hourly-time">${label}</span><span class="material-symbols-outlined" aria-hidden="true">${icon}</span><strong class="hourly-temperature">${Math.round(hourly.temperature_2m[index])}°</strong><span class="hourly-rain"><span class="material-symbols-outlined" aria-hidden="true">water_drop</span>${hourly.precipitation_probability[index] ?? 0}%</span>`;
        return item;
    }));
}

function renderDaily(forecast) {
    document.getElementById('daily-forecast').replaceChildren(...forecast.daily.time.map((date, index) => {
        const [description, icon] = conditionFor(forecast.daily.weather_code[index]);
        const row = document.createElement('div');
        row.className = 'daily-row';
        row.innerHTML = `<span class="daily-day">${localDayLabel(date, index)}</span><span class="material-symbols-outlined" aria-label="${description}">${icon}</span><span class="daily-condition">${description}</span><span class="daily-rain">${forecast.daily.precipitation_probability_max[index] ?? 0}%</span><span class="daily-temperatures"><span>${Math.round(forecast.daily.temperature_2m_max[index])}°</span><span>${Math.round(forecast.daily.temperature_2m_min[index])}°</span></span>`;
        return row;
    }));
}

async function loadForecast(city) {
    setStatus(`Loading forecast for ${placeName(city)}…`);
    const parameters = new URLSearchParams({
        latitude: city.latitude,
        longitude: city.longitude,
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m',
        hourly: 'temperature_2m,precipitation_probability,weather_code',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max',
        timezone: 'auto',
        forecast_days: '7'
    });
    try {
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${parameters}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Forecast unavailable (${response.status})`);
        const forecast = await response.json();
        renderCurrent(city, forecast);
        renderHourly(forecast);
        renderDaily(forecast);
        setStatus(`Forecast for ${placeName(city)}`);
    } catch (error) {
        setStatus(`${error.message}. Check your connection and try again.`, 'error');
    }
}

function saveCity(city) {
    const savedCity = {
        name: city.name,
        admin1: city.admin1 || '',
        country: city.country || '',
        latitude: city.latitude,
        longitude: city.longitude
    };
    localStorage.setItem(savedCityKey, JSON.stringify(savedCity));
    citySearchInput.value = '';
    loadForecast(savedCity);
}

async function searchCity(cityName) {
    const parameters = new URLSearchParams({ name: cityName, count: '6', language: 'en', format: 'json' });
    setStatus(`Searching for ${cityName}…`);
    try {
        const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${parameters}`);
        if (!response.ok) throw new Error(`City search unavailable (${response.status})`);
        const results = (await response.json()).results || [];
        if (!results.length) {
            setStatus(`No locations found for “${cityName}”. Try another spelling.`, 'error');
            return;
        }
        saveCity(results[0]);
    } catch (error) {
        setStatus(`${error.message}. Check your connection and try again.`, 'error');
    }
}

citySearchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const cityName = citySearchInput.value.trim();
    if (cityName) searchCity(cityName);
});

try {
    const savedCity = JSON.parse(localStorage.getItem(savedCityKey) || 'null');
    if (savedCity && Number.isFinite(savedCity.latitude) && Number.isFinite(savedCity.longitude)) {
        loadForecast(savedCity);
    } else {
        setStatus('Enter a city to see its forecast. Your choice will be saved on this device.');
    }
} catch {
    setStatus('Enter a city to see its forecast. Your choice will be saved on this device.');
}