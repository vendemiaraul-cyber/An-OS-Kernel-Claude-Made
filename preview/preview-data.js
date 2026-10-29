// ConMon Lab - offline preview mode.
//
// The hosted preview can't reach the internet, so this file stands in for the
// online weather service with clearly labelled SAMPLE weather. Places come
// from the built-in city list (meteo/cities.json). Only SmartestChild is
// offered as an AI engine. The real site doesn't load this.
(() => {
  "use strict";

  // Sample weather: plausible-looking numbers from latitude, season and a seed.
  // Always labelled SAMPLE on screen.
  function forecast(p) {
    let seed = Math.abs(Math.round(p.lat * 1000 + p.lon * 7)) + new Date().getUTCDate();
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const month = new Date().getUTCMonth();
    const summerNorth = Math.cos(((month - 6) / 12) * 2 * Math.PI);          // +1 in July
    const season = (p.lat >= 0 ? summerNorth : -summerNorth) * Math.min(1, Math.abs(p.lat) / 40) * 9;
    const base = 27 - Math.abs(p.lat) * 0.42 + season;
    const codes = [0, 1, 2, 3, 3, 61, 63, 80, 45, 95];
    const pick = () => {
      let c = codes[Math.floor(rnd() * codes.length)];
      if (base < 1 && c >= 61 && c < 95) c = 73;                          // snow when it's cold
      return c;
    };
    const now = new Date();
    // No time zone database offline: use the sun's offset from longitude.
    const off = p.tzOffset || 0;
    const local = new Date(now.getTime() + off * 3600000).toISOString().slice(0, 16);
    const hour = Number(local.slice(11, 13));
    const days = [0, 1, 2].map((d) => new Date(now.getTime() + d * 86400000).toISOString().slice(0, 10));
    const code0 = pick();
    const t = Math.round((base + (rnd() - 0.5) * 6) * 10) / 10;
    return {
      sample: true,
      timezone: `UTC${off >= 0 ? "+" : ""}${off} (approx.)`,
      current: {
        time: local, temperature_2m: t, apparent_temperature: Math.round((t - 1 - rnd() * 2) * 10) / 10,
        relative_humidity_2m: Math.round(45 + rnd() * 45), precipitation: code0 >= 61 ? Math.round(rnd() * 30) / 10 : 0,
        weather_code: code0, wind_speed_10m: Math.round(4 + rnd() * 25), wind_direction_10m: Math.round(rnd() * 359),
        is_day: hour >= 7 && hour < 19 ? 1 : 0,
      },
      daily: {
        time: days,
        weather_code: [code0, pick(), pick()],
        temperature_2m_max: days.map(() => Math.round(base + 3 + rnd() * 4)),
        temperature_2m_min: days.map(() => Math.round(base - 5 - rnd() * 4)),
        precipitation_probability_max: days.map(() => Math.round(rnd() * 10) * 10),
      },
    };
  }

  window.CONMON_PREVIEW = { forecast };
})();
