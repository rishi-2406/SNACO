import { useEffect, useState } from 'react';

// Small weather widget for NIT Warangal using Open-Meteo (no API key)
export default function Weather() {
  const [temperature, setTemperature] = useState(null);
  const [code, setCode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // NIT Warangal coordinates (center of campus)
  const lat = 17.983787;
  const lon = 79.530364;

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=Asia%2FKolkata`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('Weather fetch failed');
        return r.json();
      })
      .then((data) => {
        if (!mounted) return;
        if (data && data.current_weather) {
          setTemperature(Math.round(data.current_weather.temperature));
          setCode(data.current_weather.weathercode);
        } else {
          setError('No weather data');
        }
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.message || 'Failed to fetch');
      })
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, []);

  // map Open-Meteo weather codes to simple category
  function getCategory(code) {
    if (code === null || code === undefined) return 'unknown';
    // 0 = clear, 1-3 = partly cloudy/mostly clear, 45/48 fog, 51-67 drizzle/rain, 71-77 snow, 80-82 showers, 95-99 thunder
    if (code === 0) return 'clear';
    if (code >= 1 && code <= 3) return 'cloudy';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)) return 'rain';
    if (code >= 71 && code <= 77) return 'snow';
    if (code === 45 || code === 48) return 'fog';
    return 'cloudy';
  }

  function getIcon(cat) {
    // Use small emoji/symbols to keep it tiny and dependency-free
    switch (cat) {
      case 'clear':
        // Determine night vs day roughly by local hour
        const hour = new Date().getHours();
        if (hour < 6 || hour >= 19) return '🌙';
        return '☀️';
      case 'cloudy':
        return '☁️';
      case 'rain':
        return '🌧️';
      case 'snow':
        return '❄️';
      case 'fog':
        return '🌫️';
      default:
        return 'ℹ️';
    }
  }

  const category = getCategory(code);
  const icon = getIcon(category);

  return (
    <div className="text-xs text-slate-700 ml-2 flex items-center gap-2" style={{ minWidth: 80 }}>
      {loading ? (
        <span>Loading…</span>
      ) : error ? (
        <span title={error}>—</span>
      ) : (
        <>
          <span aria-hidden style={{ fontSize: 14 }}>{icon}</span>
          <span className="text-xs" aria-label={`Temperature ${temperature}°C`}>
            {temperature}°C
          </span>
        </>
      )}
    </div>
  );
}
