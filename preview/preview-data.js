// ConMon Lab - offline preview mode.
//
// The hosted preview can't reach the internet, so this file stands in for the
// online services: a list of big cities instead of Open-Meteo's place search,
// and clearly labelled SAMPLE weather instead of real forecasts. Only
// SmartestChild is offered as an AI engine. The real site doesn't load this.
(() => {
  "use strict";

  // name, country, latitude, longitude, time zone
  const CITIES = [
    ["Rome", "Italy", 41.89, 12.48, "Europe/Rome"], ["Milan", "Italy", 45.46, 9.19, "Europe/Rome"],
    ["Naples", "Italy", 40.85, 14.27, "Europe/Rome"], ["Turin", "Italy", 45.07, 7.69, "Europe/Rome"],
    ["Florence", "Italy", 43.77, 11.26, "Europe/Rome"], ["Venice", "Italy", 45.44, 12.32, "Europe/Rome"],
    ["Bologna", "Italy", 44.49, 11.34, "Europe/Rome"], ["Palermo", "Italy", 38.12, 13.36, "Europe/Rome"],
    ["Paris", "France", 48.86, 2.35, "Europe/Paris"], ["London", "United Kingdom", 51.51, -0.13, "Europe/London"],
    ["Berlin", "Germany", 52.52, 13.40, "Europe/Berlin"], ["Madrid", "Spain", 40.42, -3.70, "Europe/Madrid"],
    ["Lisbon", "Portugal", 38.72, -9.14, "Europe/Lisbon"], ["Amsterdam", "Netherlands", 52.37, 4.90, "Europe/Amsterdam"],
    ["Vienna", "Austria", 48.21, 16.37, "Europe/Vienna"], ["Zurich", "Switzerland", 47.38, 8.54, "Europe/Zurich"],
    ["Athens", "Greece", 37.98, 23.73, "Europe/Athens"], ["Istanbul", "Turkey", 41.01, 28.98, "Europe/Istanbul"],
    ["Moscow", "Russia", 55.76, 37.62, "Europe/Moscow"], ["Reykjavik", "Iceland", 64.15, -21.94, "Atlantic/Reykjavik"],
    ["Oslo", "Norway", 59.91, 10.75, "Europe/Oslo"], ["Stockholm", "Sweden", 59.33, 18.07, "Europe/Stockholm"],
    ["Cairo", "Egypt", 30.04, 31.24, "Africa/Cairo"], ["Nairobi", "Kenya", -1.29, 36.82, "Africa/Nairobi"],
    ["Lagos", "Nigeria", 6.52, 3.38, "Africa/Lagos"], ["Cape Town", "South Africa", -33.92, 18.42, "Africa/Johannesburg"],
    ["Dubai", "United Arab Emirates", 25.20, 55.27, "Asia/Dubai"], ["Mumbai", "India", 19.08, 72.88, "Asia/Kolkata"],
    ["Delhi", "India", 28.61, 77.21, "Asia/Kolkata"], ["Beijing", "China", 39.90, 116.41, "Asia/Shanghai"],
    ["Shanghai", "China", 31.23, 121.47, "Asia/Shanghai"], ["Tokyo", "Japan", 35.68, 139.69, "Asia/Tokyo"],
    ["Seoul", "South Korea", 37.57, 126.98, "Asia/Seoul"], ["Singapore", "Singapore", 1.35, 103.82, "Asia/Singapore"],
    ["Sydney", "Australia", -33.87, 151.21, "Australia/Sydney"], ["Auckland", "New Zealand", -36.85, 174.76, "Pacific/Auckland"],
    ["New York", "United States", 40.71, -74.01, "America/New_York"], ["Los Angeles", "United States", 34.05, -118.24, "America/Los_Angeles"],
    ["Chicago", "United States", 41.88, -87.63, "America/Chicago"], ["Toronto", "Canada", 43.65, -79.38, "America/Toronto"],
    ["Mexico City", "Mexico", 19.43, -99.13, "America/Mexico_City"], ["Sao Paulo", "Brazil", -23.55, -46.63, "America/Sao_Paulo"],
    ["Rio de Janeiro", "Brazil", -22.91, -43.17, "America/Sao_Paulo"], ["Buenos Aires", "Argentina", -34.60, -58.38, "America/Argentina/Buenos_Aires"],
    ["Lima", "Peru", -12.05, -77.04, "America/Lima"], ["Anchorage", "United States", 61.22, -149.90, "America/Anchorage"],
    ["Honolulu", "United States", 21.31, -157.86, "Pacific/Honolulu"],
  ];

  const norm = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").trim();

  function geocode(name) {
    const q = norm(String(name).split(",")[0]);
    const hit = CITIES.find((c) => norm(c[0]) === q) || CITIES.find((c) => norm(c[0]).startsWith(q));
    if (!hit) {
      throw new Error(`The preview only knows ${CITIES.length} big cities (try Rome, Tokyo, New York, Cairo). Your site can look up any place.`);
    }
    return { name: hit[0], country: hit[1], lat: hit[2], lon: hit[3], timezone: hit[4] };
  }

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
    const local = new Intl.DateTimeFormat("sv-SE", { timeZone: p.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(now).replace(" ", "T");
    const hour = Number(local.slice(11, 13));
    const days = [0, 1, 2].map((d) => new Date(now.getTime() + d * 86400000).toISOString().slice(0, 10));
    const code0 = pick();
    const t = Math.round((base + (rnd() - 0.5) * 6) * 10) / 10;
    return {
      sample: true,
      timezone: p.timezone,
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

  window.CONMON_PREVIEW = { geocode, forecast, cities: CITIES.length };
})();
