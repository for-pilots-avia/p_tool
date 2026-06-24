/* ═══════════════════════════════════════════
   Pilot's Tool — modules/metbriefing/index.js
   Модуль «Metbriefing» — полётный метеобрифинг
   ═══════════════════════════════════════════ */

(function() {
  'use strict';

  // ===== Static Data — loaded from metbriefing.json =====
  var _metData = null;  // { airportNames, icaoTimezones, icaoToFir, wxMaps, notamSubjects, notamConditions, notamSpecificMap, firs }

  // Mutable: AIRPORT_NAMES is seeded from JSON, then enriched by API responses at runtime
  var AIRPORT_NAMES = {};

  // Load static data from metbriefing.json (replaces inline objects + firs.json)
  function loadMetData(callback) {
    fetch('modules/metbriefing/data/metbriefing.json')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        _metData = data;
        // Seed AIRPORT_NAMES from JSON (mutable — will be enriched by API)
        var seed = data.airportNames || {};
        for (var k in seed) {
          if (seed.hasOwnProperty(k)) AIRPORT_NAMES[k] = seed[k];
        }
        // Seed firsData for SIGMET
        if (data.firs) state.firsData = data.firs;
        if (callback) callback();
      })
      .catch(function(err) {
        console.error('metbriefing: loadMetData error:', err);
        if (callback) callback();
      });
  }

  // Accessors for _metData with safe fallback
  function getIcaoTz(icao) { return (_metData && _metData.icaoTimezones && _metData.icaoTimezones[icao]) || ''; }
  function getIcaoToFir(key) { return (_metData && _metData.icaoToFir && _metData.icaoToFir[key]) || null; }
  function getWxMaps() { return (_metData && _metData.wxMaps) || []; }
  function getWindMaps() { return (_metData && _metData.windMaps) || null; }
  function getNotamSubject(key) { return (_metData && _metData.notamSubjects && _metData.notamSubjects[key]) || key; }
  function getNotamCondition(key) { return (_metData && _metData.notamConditions && _metData.notamConditions[key]) || ''; }
  function getNotamSpecific(key) { return (_metData && _metData.notamSpecificMap && _metData.notamSpecificMap[key]) || ''; }

  // Task 24: HTML-escape helper — для защиты от HTML-инъекций через METAR/TAF/NOTAM/airport info.
  // Экранирует & < > " ' — этого достаточно дляtextContent-эквивалента внутри HTML.
  // Применяется ко всем внешним данным (METAR/TAF raw, NOTAM id/subject/description, stationInfo).
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var CACHE_TTL_MS = 30 * 60 * 1000;
  var STATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours for station cache
  var WX_MAP_STALE_MS = 2 * 60 * 60 * 1000; // 2 hours — weather maps stale threshold
  var SIGMET_STALE_MS = 60 * 60 * 1000; // 1 hour — Task 21: было 10 мин, стало 1 час (по запросу пользователя)

  // ===== API Constants (secrets moved to Worker env — Task 28) =====
  // AVWX_TOKEN, CHECKWX_KEY — теперь живут в Cloudflare Worker env (wrangler secret put),
  // НЕ в клиентском коде. CheckWX/AVWX запросы идут через Worker /wx-station, /wx-metar, /wx-taf.
  // avia-meteo.ru — PRIMARY source для METAR/TAF (Task 28): bulk text через /am-metar, /am-taf.
  // Worker /wxmap whitelist: meteoinfo.ru, tgftp.nws.noaa.gov, avia-meteo.ru, meteocenter.net.
  var NOTAM_API_URL = 'https://notams.online/api/notams.php';
  var NOTAM_XOR_KEY = 'NotamViewer@1.0.0-OZ_2026!#';
  var AWC_PROXY_URL = 'https://aviation-proxy.777b737.workers.dev';
  // Priority: avia-meteo (primary) → Worker /wx-metar,/wx-taf (CheckWX→AVWX) → AWC proxy (last resort)

  // ===== Weather Maps & FIR — loaded from metbriefing.json =====
  // WX_MAPS and ICAO_TO_FIR are now in _metData.wxMaps / _metData.icaoToFir
  // Use getWxMaps() / getIcaoToFir() accessors

  // Get the FIR code for a given ICAO airport code
  function getFirForAirport(icao) {
    if (!icao || icao.length < 2) return null;
    // Try exact 4-char match first (e.g., EGLL → EGTT)
    if (getIcaoToFir(icao)) return getIcaoToFir(icao);
    // Then try 2-char prefix
    var prefix = icao.substring(0, 2);
    if (getIcaoToFir(prefix)) return getIcaoToFir(prefix);
    return null;
  }

  // AVWX blocks Russian/Belarusian airports; detect that error
  var AVWX_BLOCK_MSG = 'blocking requests for airports in';

  // ===== NOTAM Q-Code Dictionaries — loaded from metbriefing.json =====
  // Use getNotamSubject(key), getNotamCondition(key), getNotamSpecific(key) accessors

  // ===== NOTAM Parsing Functions =====

  // XOR Decrypt for notams.online Base64-encoded response
  function xorDecrypt(base64Data) {
    var raw = atob(base64Data);
    var keyBuf = NOTAM_XOR_KEY;
    var result = '';
    for (var i = 0; i < raw.length; i++) {
      result += String.fromCharCode(raw.charCodeAt(i) ^ keyBuf.charCodeAt(i % keyBuf.length));
    }
    return result;
  }

  // Classify NOTAM criticality
  function classifyNotam(text) {
    var upper = text.toUpperCase();
    if (/RWY\s+\S+\s+CLSD|AIRSPACE\s+CLSD|AD\s+CLSD|ILS\s+U\/S|VOR\s+U\/S|NDB\s+U\/S|DME\s+U\/S|RNP\s+U\/S|APCH\s+CLSD|AD\s+NOT\s+AVBL/i.test(upper)) return 'high';
    if (/QMRLT|QMRLC|QNVU|QNAU|QFAXX|QICAS/i.test(upper)) return 'high';
    if (/TWY\s+CLSD|TWY\s+RESTRICT|APRON\s+CLSD|LGT\s+U\/S|OBST|CRANE|BIRD|WIP/i.test(upper)) return 'medium';
    if (/QMTCH|QMTLV|QFALU|QOBST|QOBCE|QBDFG/i.test(upper)) return 'medium';
    return 'low';
  }

  // Parse NOTAM type from text
  function parseNotamType(text) {
    if (/NOTAMN/i.test(text)) return 'N';
    if (/NOTAMR/i.test(text)) return 'R';
    if (/NOTAMC/i.test(text)) return 'C';
    return 'I';
  }

  // Decode Q-code into subject + condition
  function decodeQCode(qCode) {
    if (!qCode || qCode.length < 5) return { subject: '', condition: '', full: qCode };
    var subjKey = qCode.substring(1, 3).toUpperCase();
    var condKey = qCode.substring(3, 5).toUpperCase();
    var subject = getNotamSubject(subjKey) || subjKey;
    var condition = getNotamCondition(condKey) || '';
    var full = condition ? subject + ' \u2014 ' + condition : subject;
    return { subject: subject, condition: condition, full: full };
  }

  // Extract Q-code from NOTAM text
  function extractQCode(text) {
    var qMatch = text.match(/Q\)\s*([A-Z]{4})\/([A-Z]{4,6})\//i);
    if (qMatch) return qMatch[2].toUpperCase();
    return '';
  }

  // Parse NOTAM subject from Q-line
  function parseSubject(text) {
    var qMatch = text.match(/Q\)\s*([A-Z]{4})\/([A-Z]{4,6})\//i);
    if (qMatch) {
      var subjectCode = qMatch[2].toUpperCase();
      var specific = getNotamSpecific(subjectCode);
      if (specific) return specific;
      var decoded = decodeQCode(subjectCode);
      return decoded.full || subjectCode;
    }
    return '';
  }

  // Parse NOTAM description (E) section
  function parseDescription(text) {
    var eMatch = text.match(/E\)\s*([\s\S]*?)(?:$|F\))/i);
    if (eMatch) return eMatch[1].trim();
    var eIdx = text.indexOf('E)');
    if (eIdx !== -1) return text.slice(eIdx + 2).trim();
    return text;
  }

  // Parse date from NOTAM date string
  function parseNotamDate(dateStr) {
    if (!dateStr) return '';
    var match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2})(\d{2})?/);
    if (match) {
      return match[3] + '-' + match[1] + '-' + match[2] + 'T' + match[4] + ':' + (match[5] || '00') + ':00Z';
    }
    var notamDate = dateStr.match(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (notamDate) {
      var year = 2000 + parseInt(notamDate[1], 10);
      return year + '-' + notamDate[2] + '-' + notamDate[3] + 'T' + notamDate[4] + ':' + notamDate[5] + ':00Z';
    }
    return dateStr;
  }

  // ===== Browser-side METAR Parser =====
  function parseMetar(raw) {
    var cleaned = raw.trim().replace(/^(METAR|SPECI)\s+/i, '');
    var parts = cleaned.split(/\s+/);
    var i = 0;
    if (/^[A-Z]{4}$/.test(parts[0])) i = 1;
    if (/^\d{6}Z$/.test(parts[i])) i++;
    while (i < parts.length && ['COR', 'AUTO', 'AMD', 'NSW', 'CCA', 'CCB'].indexOf(parts[i]) !== -1) i++;
    var wind = { direction: '000', speed: 0, gusts: null, unit: 'KT' };
    var wm = parts[i] && parts[i].match(/^(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?(KT|MPS|KMH)/);
    if (wm) { wind = { direction: wm[1], speed: parseInt(wm[2], 10), gusts: wm[4] ? parseInt(wm[4], 10) : null, unit: wm[5] === 'MPS' ? 'MPS' : 'KT' }; i++; }
    if (i < parts.length && /^\d{3}V\d{3}$/.test(parts[i])) i++;
    var visibility = { value: 9999, unit: 'm' };
    var isCavok = false;
    if (parts[i] === 'CAVOK') { isCavok = true; i++; }
    else if (parts[i] === '9999') { i++; }
    else if (/^\d{4}$/.test(parts[i])) { visibility = { value: parseInt(parts[i], 10), unit: 'm' }; i++; }
    else if (/^P?\d+SM$/.test(parts[i])) { visibility = { value: 9999, unit: 'm' }; i++; }
    var weather = [];
    if (!isCavok) {
      var wp = /^(\+|-|VC)?((MI|BC|PR|DR|BL|SH|TS|FZ){1,2})?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS|SH|TS|FZRA|FZDZ|SNRA|RASN)$/i;
      while (i < parts.length && wp.test(parts[i])) { weather.push(parts[i]); i++; }
    }
    var clouds = [];
    if (!isCavok) {
      var cr = /^(FEW|SCT|BKN|OVC|SKC|NCD|CLR|VV|NSC)(\d{3})?$/i;
      while (i < parts.length) {
        var cm = parts[i] && parts[i].match(cr);
        if (cm) {
          var amt = cm[1].toUpperCase();
          if (['NSC','CLR','SKC','NCD'].indexOf(amt) === -1) {
            clouds.push({ amount: amt, base: cm[2] ? parseInt(cm[2], 10) * 100 : 0, unit: 'ft' });
          }
          i++;
        } else break;
      }
    }
    var temperature = 0, dewpoint = 0;
    var tr = /^(M?\d{2})\/(M?\d{2})$/;
    while (i < parts.length) {
      if (tr.test(parts[i])) {
        var tm = parts[i].match(tr);
        temperature = tm[1].charAt(0) === 'M' ? -parseInt(tm[1].slice(1), 10) : parseInt(tm[1], 10);
        dewpoint = tm[2].charAt(0) === 'M' ? -parseInt(tm[2].slice(1), 10) : parseInt(tm[2], 10);
        i++; break;
      }
      i++;
    }
    var qnh = 1013;
    var qr = /^(Q|A)(\d{4})$/;
    while (i < parts.length) {
      if (qr.test(parts[i])) {
        var qm = parts[i].match(qr);
        qnh = qm[1] === 'Q' ? parseInt(qm[2], 10) : Math.round((parseInt(qm[2], 10) / 100) * 33.8639);
        i++; break;
      }
      i++;
    }
    return { wind: wind, visibility: visibility, temperature: temperature, dewpoint: dewpoint, qnh: qnh, clouds: clouds, weather: weather };
  }

  // ===== State =====
  var state = {
    activeTab: 'briefing',
    depIcao: '',
    arrIcao: '',
    altIcaos: [],
    altInput: '',
    weatherCache: {},
    wxLoading: {},
    wxErrors: {},
    expandedMetar: {},
    expandedTaf: {},
    expandedNotam: {},
    wxSearchInput: '',
    extraAirports: [],
    prevRoute: '',
    notamCache: {},
    notamLoading: {},
    notamErrors: {},
    notamAirports: [],
    expandedNotamTab: {},
    notamSearchInput: '',
    filterTab: 'all',
    textFilter: '',
    notamLastRefresh: {},
    manualNotamAirports: {},
    // checklistProgress removed — replaced by Weather Maps block
    tickInterval: null,
    sigmetRefreshInterval: null,   // автообновление SIGMET (как карты погоды)
    weatherLoaded: false,
    // AVWX data
    avwxStation: {},    // { ICAO: stationInfo }
    avwxStationLoading: false,
    metarHistory: {},      // { ICAO: [{ raw, observedAt, flightCat }] } — fetched from AWC on demand
    metarHistoryLoading: {}, // { ICAO: true/false }
    wxMapCache: {},       // { url: { blobUrl: 'blob:...', fetchedAt: timestamp } }
    wxMapLoading: false,  // true while maps are being refreshed
    wxMapLoaded: {},       // { url: true } — tracks if <img> loaded successfully via onload
    // Task 28: avia-meteo.ru bulk text cache (METAR+TAF primary source)
    amMetarBulk: null,    // { text: '...', fetchedAt: timestamp }
    amTafBulk: null,      // { text: '...', fetchedAt: timestamp }
    amLoading: false,     // true while fetching avia-meteo bulk
    // Task 28: Wind-by-flight-level maps (FL100-FL390, +6h, area C)
    windLevel: 340,       // selected flight level (default from windMaps.defaultLevel)
    windMapCache: {},     // { level: { blobUrl: 'blob:...', fetchedAt: timestamp } }
    windMapLoading: false, // true while preloading wind maps
    windMapLoaded: {},     // { level: true } — tracks if <img> loaded successfully
    // SIGMET
    sigmetCache: null,     // { intl: [...], us: [...], fetchedAt: timestamp }
    sigmetLoading: false,
    sigmetError: null,
    sigmetFirFilter: 'route',  // 'route' | FIR ID | country name | 'all'
    firsData: null         // seeded from metbriefing.json .firs
  };

  // Task 24: §8 — module-scope ссылки на document listeners для header menu overlay.
  // Хранятся как module-private (НЕ window.*) — позволяет removeEventListener в closeHeaderMenu/destroy.
  var _onHeaderMenuDocClick = null;
  var _onHeaderMenuKeydown = null;

  // Task 24: единая функция закрытия dropdown + overlay + снятия listeners (§8 условие 1, 2).
  function closeHeaderMenu() {
    var dropdown = document.getElementById('mbHeaderMenuDropdown');
    var overlay = document.getElementById('mbHeaderMenuOverlay');
    var btn = document.getElementById('mbHeaderMenuBtn');
    if (dropdown) dropdown.classList.remove('metbriefing-header-menu--open');
    if (overlay) {
      overlay.classList.remove('metbriefing-header-menu-overlay--visible');
      overlay.setAttribute('aria-hidden', 'true');
    }
    if (btn) btn.setAttribute('aria-expanded', 'false');
    // §8 условие 1: listener добавляется при открытии, удаляется при закрытии
    if (_onHeaderMenuDocClick) {
      document.removeEventListener('click', _onHeaderMenuDocClick);
      _onHeaderMenuDocClick = null;
    }
    if (_onHeaderMenuKeydown) {
      document.removeEventListener('keydown', _onHeaderMenuKeydown);
      _onHeaderMenuKeydown = null;
    }
  }

  // ===== Utility: icon helper =====
  function icon(name, size, extraClass) {
    var svg = (window.ICONS && window.ICONS[name]) || '';
    if (size) {
      if (/width="24"/.test(svg)) {
        svg = svg.replace(/width="24"/g, 'width="' + size + '"')
                 .replace(/height="24"/g, 'height="' + size + '"');
      } else if (/<svg/.test(svg)) {
        svg = svg.replace(/<svg/, '<svg width="' + size + '" height="' + size + '"');
      }
    }
    if (extraClass) {
      svg = svg.replace('<svg ', '<svg class="' + extraClass + '" ');
    }
    return svg;
  }

  // ===== Time Helpers =====
  function isDayTime(icao) {
    var tz = getIcaoTz(icao);
    if (!tz) return true;
    try {
      var now = new Date();
      var hour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(now), 10);
      return hour >= 6 && hour < 21;
    } catch(e) { return true; }
  }

  function isNightAtAirport(icao) { return !isDayTime(icao); }

  function getLocalTime(icao) {
    var tz = getIcaoTz(icao);
    if (!tz) return '--:--';
    try {
      return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date());
    } catch(e) { return '--:--'; }
  }

  function getUtcOffset(tz, date) {
    var utcStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hour12: false, timeZone: 'UTC' }).format(date);
    var localStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hour12: false, timeZone: tz }).format(date);
    var uh = parseInt(utcStr.split(':')[0], 10) || 0;
    var um = parseInt(utcStr.split(':')[1], 10) || 0;
    var lh = parseInt(localStr.split(':')[0], 10) || 0;
    var lm = parseInt(localStr.split(':')[1], 10) || 0;
    var diff = (lh * 60 + lm) - (uh * 60 + um);
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    return Math.round(diff / 60);
  }

  function getTimeDiff(depIcao, arrIcao) {
    var depTz = getIcaoTz(depIcao);
    var arrTz = getIcaoTz(arrIcao);
    if (!depTz || !arrTz) return null;
    try {
      var now = new Date();
      var depOffset = getUtcOffset(depTz, now);
      var arrOffset = getUtcOffset(arrTz, now);
      var diff = arrOffset - depOffset;
      if (diff === 0) return '0\u0447';
      return diff > 0 ? '+' + diff + '\u0447' : diff + '\u0447';
    } catch(e) { return null; }
  }

  // ===== Weather Helpers =====
  function getWxVisibilityClass(vis) {
    if (vis === null || vis === undefined) return '';
    if (vis >= 5000) return 'metbriefing-wx-vis--green';
    if (vis >= 1000) return 'metbriefing-wx-vis--yellow';
    return 'metbriefing-wx-vis--red';
  }

  function getWindClass(wind) {
    if (!wind) return '';
    var speedKt = wind.unit === 'MPS' ? wind.speed * 1.944 : wind.speed;
    if (speedKt > 35) return 'metbriefing-wx-wind--red';
    if (speedKt > 25) return 'metbriefing-wx-wind--orange';
    return '';
  }

  function getGustClass(wind) {
    if (!wind || !wind.gusts) return '';
    var gustKt = wind.unit === 'MPS' ? wind.gusts * 1.944 : wind.gusts;
    if (gustKt > 35) return 'metbriefing-wx-wind--red';
    if (gustKt > 25) return 'metbriefing-wx-wind--orange';
    return '';
  }

  // ===== METAR Weather Phenomenon → Icon Mapping =====
  // Order matters: more specific patterns checked first
  // TS = thunderstorm, GR = hail, GS = small hail, RA = rain, DZ = drizzle,
  // SN = snow, SG = snow grains, IC = ice crystals, PL = ice pellets, PE = ice pellets,
  // FG = fog, FZFG = freezing fog, BR = mist, HZ = haze, FU = smoke, VA = volcanic ash,
  // DU = dust, DS = duststorm, SS = sandstorm, SQ = squall, FC = funnel cloud/tornado,
  // SH = shower, FZ = freezing, BL = blowing, DR = drifting, MI = shallow, PR = partial
  function getWeatherIconName(wx) {
    var lower = wx.toLowerCase();
    // Thunderstorm (any TS combination) → cloud-lightning
    if (lower.indexOf('ts') !== -1) return 'cloud-lightning';
    // Funnel cloud / tornado → tornado
    if (lower.indexOf('fc') !== -1) return 'tornado';
    // Squall → wind
    if (lower.indexOf('sq') !== -1) return 'wind';
    // Hail (GR) → cloud-hail (must check before GR in TSGR)
    if (lower.indexOf('gr') !== -1) return 'cloud-hail';
    // Small hail / snow pellets (GS) → cloud-hail
    if (lower.indexOf('gs') !== -1) return 'cloud-hail';
    // Freezing rain (FZRA) → cloud-sleet (ice + rain mix)
    if (lower.indexOf('fzra') !== -1) return 'cloud-sleet';
    // Freezing drizzle (FZDZ) → cloud-sleet
    if (lower.indexOf('fzdz') !== -1) return 'cloud-sleet';
    // Ice pellets (PL, PE) → cloud-sleet
    if (lower.indexOf('pl') !== -1 || lower.indexOf('pe') !== -1) return 'cloud-sleet';
    // Ice crystals (IC) → cloud-sleet
    if (lower.indexOf('ic') !== -1) return 'cloud-sleet';
    // Snow (SN, SHSN, BLSN, DRSN) → cloud-snow
    if (lower.indexOf('sn') !== -1) return 'cloud-snow';
    // Snow grains (SG) → cloud-snow
    if (lower.indexOf('sg') !== -1) return 'cloud-snow';
    // Rain / Rain showers (RA, SHRA) → cloud-rain
    if (lower.indexOf('ra') !== -1 || lower.indexOf('sh') !== -1) return 'cloud-rain';
    // Drizzle (DZ) → cloud-drizzle
    if (lower.indexOf('dz') !== -1) return 'cloud-drizzle';
    // Freezing fog (FZFG) → cloud-fog
    if (lower.indexOf('fzfg') !== -1) return 'cloud-fog';
    // Fog (FG, PRFG, MIFG) → cloud-fog
    if (lower.indexOf('fg') !== -1) return 'cloud-fog';
    // Mist (BR) → cloud-haze
    if (lower.indexOf('br') !== -1) return 'cloud-haze';
    // Haze (HZ) → cloud-haze
    if (lower.indexOf('hz') !== -1) return 'cloud-haze';
    // Smoke (FU) → cloud-haze
    if (lower.indexOf('fu') !== -1) return 'cloud-haze';
    // Volcanic ash (VA) → cloud-haze
    if (lower.indexOf('va') !== -1) return 'cloud-haze';
    // Duststorm (DS), Sandstorm (SS), Blowing dust/sand (BLDU, BLSA) → wind
    if (lower.indexOf('ds') !== -1 || lower.indexOf('ss') !== -1) return 'wind';
    // Dust (DU), Blowing (BL) → wind
    if (lower.indexOf('du') !== -1 || lower.indexOf('bl') !== -1) return 'wind';
    // Default fallback
    return 'cloud';
  }

  function getCloudIconName(amount) {
    if (amount === 'SKC' || amount === 'NCD' || amount === 'CLR') return 'sun';
    if (amount === 'FEW') return 'cloud-sun';
    if (amount === 'SCT') return 'cloud-sun';
    return 'cloud';
  }

  function formatBriefVis(vis) {
    if (!vis) return '\u2014';
    if (vis.value >= 9999) return 'CAVOK';
    return vis.value + ' \u043C';
  }

  function formatVisibility(vis) {
    if (!vis) return 'N/A';
    if (vis.value >= 9999) return '>10 \u043A\u043C';
    if (vis.unit === 'm') return vis.value >= 1000 ? (vis.value / 1000).toFixed(1) + ' \u043A\u043C' : vis.value + ' \u043C';
    return vis.value + ' ' + vis.unit;
  }

  function formatWind(wind) {
    if (!wind) return 'N/A';
    var dir = wind.direction === 'VRB' ? 'VRB' : wind.direction + '\u00B0';
    var spd = wind.unit === 'MPS' ? wind.speed + ' \u043C/\u0441' : wind.speed + ' kt';
    var gust = wind.gusts ? (wind.unit === 'MPS' ? ' G' + wind.gusts + ' \u043C/\u0441' : ' G' + wind.gusts + ' kt') : '';
    return dir + ' ' + spd + gust;
  }

  function formatTemp(temp) {
    if (temp === null || temp === undefined) return 'N/A';
    return (temp > 0 ? '+' : '') + temp + '\u00B0C';
  }

  function formatQNH(qnh) {
    if (qnh === null || qnh === undefined) return 'N/A';
    return 'Q' + qnh;
  }

  function formatCloudsBrief(clouds) {
    if (!clouds || clouds.length === 0) return '\u042F\u0441\u043D\u043E';
    return clouds.map(function(c) {
      if (c.amount === 'SKC' || c.amount === 'NCD' || c.amount === 'CLR') return '\u042F\u0441\u043D\u043E';
      return c.amount + c.base;
    }).join(' ');
  }

  function formatCloudsWx(clouds) {
    if (!clouds || clouds.length === 0) return 'CAVOK';
    return clouds.map(function(c) {
      if (c.base === 0) return c.amount;
      return c.amount + String(Math.round(c.base / 100)).padStart(3, '0');
    }).join(' ');
  }

  // ===== Flight Rules Helpers =====
  function getFlightRulesClass(flightRules) {
    if (!flightRules) return 'metbriefing-fr--vfr';
    var fr = flightRules.toUpperCase();
    if (fr === 'LIFR') return 'metbriefing-fr--lifr';
    if (fr === 'IFR') return 'metbriefing-fr--ifr';
    if (fr === 'MVFR') return 'metbriefing-fr--mvfr';
    return 'metbriefing-fr--vfr';
  }

  function getFlightRulesLabel(flightRules) {
    if (!flightRules) return '';
    var fr = flightRules.toUpperCase();
    if (fr === 'LIFR') return 'LIFR';
    if (fr === 'IFR') return 'IFR';
    if (fr === 'MVFR') return 'MVFR';
    return 'VFR';
  }

  function getFlightRulesBorderClass(flightRules) {
    if (!flightRules) return 'metbriefing-inline-weather--day';
    var fr = flightRules.toUpperCase();
    if (fr === 'LIFR') return 'metbriefing-inline-weather--lifr';
    if (fr === 'IFR') return 'metbriefing-inline-weather--ifr';
    if (fr === 'MVFR') return 'metbriefing-inline-weather--mvfr';
    return 'metbriefing-inline-weather--vfr';
  }

  // Border class for weather tab cards (uses wx-card prefix)
  function getWxCardBorderClass(flightRules, isNight) {
    if (flightRules) {
      var fr = flightRules.toUpperCase();
      if (fr === 'LIFR') return 'metbriefing-wx-card--lifr';
      if (fr === 'IFR') return 'metbriefing-wx-card--ifr';
      if (fr === 'MVFR') return 'metbriefing-wx-card--mvfr';
      return 'metbriefing-wx-card--vfr';
    }
    return isNight ? 'metbriefing-wx-card--night' : 'metbriefing-wx-card--day';
  }

  function formatTime(iso) {
    if (!iso) return 'N/A';
    try {
      var d = new Date(iso);
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' Z';
    } catch(e) { return 'N/A'; }
  }

  // ===== NOTAM Helpers =====
  function formatNotamDate(iso) {
    if (!iso) return '\u2014';
    if (iso === 'PERM') return '\u041F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E';
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' Z';
    } catch(e) { return iso; }
  }

  function formatRelativeTime(iso) {
    if (!iso) return '';
    try {
      var now = Date.now();
      var diff = now - new Date(iso).getTime();
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return '\u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u043E';
      if (mins < 60) return mins + ' \u043C\u0438\u043D \u043D\u0430\u0437\u0430\u0434';
      var hours = Math.floor(mins / 60);
      if (hours < 24) return hours + ' \u0447 \u043D\u0430\u0437\u0430\u0434';
      var days = Math.floor(hours / 24);
      return days + ' \u0434\u043D \u043D\u0430\u0437\u0430\u0434';
    } catch(e) { return ''; }
  }

  function getCriticalityLabel(c) {
    if (c === 'high') return '\u0412\u044B\u0441\u043E\u043A\u0430\u044F';
    if (c === 'medium') return '\u0421\u0440\u0435\u0434\u043D\u044F\u044F';
    return '\u041D\u0438\u0437\u043A\u0430\u044F';
  }

  // Checklist removed — replaced by Weather Maps block

  // ===== SIGMET — опасные явления =====

  function fetchSigmetData(forceRefresh) {
    if (state.sigmetLoading) return;
    // Check stale cache
    if (!forceRefresh && state.sigmetCache && !isStale(state.sigmetCache.fetchedAt, SIGMET_STALE_MS)) return;

    state.sigmetLoading = true;
    state.sigmetError = null;
    renderCurrentTab();

    var intlPromise = fetch(AWC_PROXY_URL + '/sigmet?type=intl')
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function() { return []; });

    var usPromise = fetch(AWC_PROXY_URL + '/sigmet?type=us')
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function() { return []; });

    Promise.all([intlPromise, usPromise])
      .then(function(results) {
        state.sigmetCache = {
          intl: Array.isArray(results[0]) ? results[0] : [],
          us: Array.isArray(results[1]) ? results[1] : [],
          fetchedAt: Date.now()
        };
        state.sigmetLoading = false;
        saveSigmetCache();
        renderCurrentTab();
      })
      .catch(function(err) {
        state.sigmetLoading = false;
        state.sigmetError = err.message || 'Ошибка загрузки SIGMET';
        renderCurrentTab();
      });
  }

  function saveSigmetCache() {
    if (!state.sigmetCache) return;
    try {
      localStorage.setItem('sigmet-cache', JSON.stringify(state.sigmetCache));
    } catch(e) {}
  }

  function loadSigmetCache() {
    try {
      var raw = localStorage.getItem('sigmet-cache');
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && data.intl && data.us) {
        state.sigmetCache = data;
      }
    } catch(e) {}
  }

  function getRouteFirIds() {
    var firIds = [];
    var airports = getAllRouteAirports();
    airports.forEach(function(icao) {
      var fir = getFirForAirport(icao);
      if (fir && firIds.indexOf(fir) === -1) firIds.push(fir);
      // Also add all FIRs matching the 2-char prefix
      var prefix = icao.substring(0, 2);
      if (state.firsData) {
        state.firsData.forEach(function(f) {
          if (f.firId && f.firId.substring(0, 2) === prefix && firIds.indexOf(f.firId) === -1) {
            firIds.push(f.firId);
          }
        });
      }
    });
    return firIds;
  }

  function filterSigmetsForRoute(sigmets, firIds) {
    if (!firIds || firIds.length === 0) return [];
    return sigmets.filter(function(s) {
      if (!s.firId) return false;
      // Exact match
      if (firIds.indexOf(s.firId) !== -1) return true;
      // Prefix match: FIR from route "UUWV" matches SIGMET firId starting with "UU"
      for (var i = 0; i < firIds.length; i++) {
        var routeFir = firIds[i];
        if (s.firId.substring(0, 2) === routeFir.substring(0, 2)) return true;
      }
      return false;
    });
  }

  function getHazardIcon(hazard) {
    if (!hazard) return 'alert-triangle';
    var h = hazard.toLowerCase();
    if (h.indexOf('ts') !== -1 || h.indexOf('thunderstorm') !== -1 || h.indexOf('convective') !== -1) return 'cloud-lightning';
    if (h.indexOf('turb') !== -1 || h.indexOf('turbulence') !== -1) return 'wind';
    if (h.indexOf('ice') !== -1 || h.indexOf('icing') !== -1 || h.indexOf('frz') !== -1) return 'cloud-snow';
    if (h.indexOf('va') !== -1 || h.indexOf('volcanic') !== -1 || h.indexOf('ash') !== -1) return 'cloud-alert';
    if (h.indexOf('mtw') !== -1 || h.indexOf('mountain') !== -1 || h.indexOf('wave') !== -1) return 'wind';
    return 'alert-triangle';
  }

  function getHazardLabel(hazard) {
    if (!hazard) return 'Опасное явление';
    var h = hazard.toLowerCase();
    if (h.indexOf('ts') !== -1 || h.indexOf('thunderstorm') !== -1) return 'Гроза';
    if (h.indexOf('convective') !== -1) return 'Конвекция';
    if (h.indexOf('turb') !== -1 || h.indexOf('turbulence') !== -1) return 'Турбулентность';
    if (h.indexOf('ice') !== -1 || h.indexOf('icing') !== -1 || h.indexOf('frz') !== -1) return 'Обледенение';
    if (h.indexOf('va') !== -1 || h.indexOf('volcanic') !== -1) return 'Вулк. пепел';
    if (h.indexOf('mtw') !== -1 || h.indexOf('mountain') !== -1) return 'Горн. волна';
    return hazard;
  }

  function formatFlLevel(level) {
    if (!level) return '';
    var s = String(level);
    if (s.indexOf('FL') === 0) {
      return s + ' (' + Math.round(parseInt(s.replace('FL', ''), 10) * 30.48) + ' м)';
    }
    // Numeric feet value → convert to FL
    var feet = parseInt(s, 10);
    if (!isNaN(feet) && feet > 0) {
      var fl = Math.round(feet / 100);
      return 'FL' + fl + ' (' + Math.round(feet * 0.3048) + ' м)';
    }
    return s;
  }

  // ===== Briefing Readiness =====
  function getReadiness() {
    var issues = [];
    if (state.depIcao.length < 4) issues.push('\u0410\u044D\u0440\u043E\u043F\u043E\u0440\u0442 \u0432\u044B\u043B\u0435\u0442\u0430 \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D');
    if (state.arrIcao.length < 4) issues.push('\u0410\u044D\u0440\u043E\u043F\u043E\u0440\u0442 \u043F\u043E\u0441\u0430\u0434\u043A\u0438 \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D');

    if (issues.length === 0) return { level: 'green', label: '\u0411\u0440\u0438\u0444\u0438\u043D\u0433 \u0433\u043E\u0442\u043E\u0432', issues: [] };
    if (issues.length <= 2) return { level: 'yellow', label: '\u0411\u0440\u0438\u0444\u0438\u043D\u0433 \u0447\u0430\u0441\u0442\u0438\u0447\u043D\u043E \u0433\u043E\u0442\u043E\u0432', issues: issues };
    return { level: 'red', label: '\u0411\u0440\u0438\u0444\u0438\u043D\u0433 \u043D\u0435 \u0433\u043E\u0442\u043E\u0432', issues: issues };
  }

  // ===== Data Status Warnings (for "Брифинг готов" block) =====
  function getDataStatusWarnings() {
    var warnings = [];
    var allAirports = getAllRouteAirports();

    // Weather status per airport
    allAirports.forEach(function(icao) {
      var wxData = state.weatherCache[icao];
      var wxLoading = state.wxLoading[icao];
      var wxError = state.wxErrors[icao];

      if (wxLoading) {
        warnings.push({ type: 'loading', icon: 'rotate-ccw', label: '\u041F\u043E\u0433\u043E\u0434\u0430 ' + icao, detail: '\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...', action: null });
      } else if (wxError && !wxData) {
        warnings.push({ type: 'error', icon: 'alert-triangle', label: '\u041F\u043E\u0433\u043E\u0434\u0430 ' + icao, detail: wxError, action: 'wx-retry-' + icao });
      } else if (wxData && isStale(wxData.cachedAt)) {
        warnings.push({ type: 'stale', icon: 'alert-triangle', label: '\u041F\u043E\u0433\u043E\u0434\u0430 ' + icao, detail: '\u0423\u0441\u0442\u0430\u0440\u0435\u043B\u0438 (' + formatRelativeTime(new Date(wxData.cachedAt).toISOString()) + ')', action: 'wx-refresh-' + icao });
      } else if (!wxData) {
        warnings.push({ type: 'missing', icon: 'cloud', label: '\u041F\u043E\u0433\u043E\u0434\u0430 ' + icao, detail: '\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445', action: 'wx-fetch-' + icao });
      }
    });

    // NOTAM status per airport
    allAirports.forEach(function(icao) {
      var ntData = state.notamCache[icao];
      var ntLoading = state.notamLoading[icao];
      var ntError = state.notamErrors[icao];

      if (ntLoading) {
        warnings.push({ type: 'loading', icon: 'rotate-ccw', label: 'NOTAM ' + icao, detail: '\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...', action: null });
      } else if (ntError && !ntData) {
        warnings.push({ type: 'error', icon: 'alert-triangle', label: 'NOTAM ' + icao, detail: ntError, action: 'nt-retry-' + icao });
      } else if (ntData && isStale(ntData.fetchedAt, NOTAM_STALE_MS)) {
        warnings.push({ type: 'stale', icon: 'alert-triangle', label: 'NOTAM ' + icao, detail: '\u0423\u0441\u0442\u0430\u0440\u0435\u043B\u0438 (' + formatRelativeTime(new Date(ntData.fetchedAt).toISOString()) + ')', action: 'nt-refresh-' + icao });
      } else if (!ntData) {
        warnings.push({ type: 'missing', icon: 'alert-triangle', label: 'NOTAM ' + icao, detail: '\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445', action: 'nt-fetch-' + icao });
      }
    });

    // Weather maps status — check both cache (for offline) and visibility (img onload)
    var mapsAllVisible = getWxMaps().every(function(map) { return state.wxMapLoaded[map.url]; });
    var mapsAnyCached = getWxMaps().some(function(map) {
      var cached = state.wxMapCache[map.url];
      return cached && cached.blobUrl;
    });
    var mapsAllCachedFresh = getWxMaps().every(function(map) {
      var cached = state.wxMapCache[map.url];
      return cached && cached.blobUrl && !isStale(cached.fetchedAt, WX_MAP_STALE_MS);
    });
    var mapsAnyStale = getWxMaps().some(function(map) {
      var cached = state.wxMapCache[map.url];
      return cached && cached.blobUrl && isStale(cached.fetchedAt, WX_MAP_STALE_MS);
    });
    if (state.wxMapLoading) {
      warnings.push({ type: 'loading', icon: 'rotate-ccw', label: '\u041A\u0430\u0440\u0442\u044B \u043F\u043E\u0433\u043E\u0434\u044B', detail: '\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...', action: null });
    } else if (!mapsAllVisible && !mapsAnyCached) {
      // No maps visible and nothing in cache — truly not loaded
      warnings.push({ type: 'missing', icon: 'alert-triangle', label: '\u041A\u0430\u0440\u0442\u044B \u043F\u043E\u0433\u043E\u0434\u044B', detail: '\u041D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u044B', action: 'maps-refresh' });
    } else if (mapsAllVisible && !mapsAnyCached) {
      // Maps visible but not cached — offline will not work
      warnings.push({ type: 'stale', icon: 'alert-triangle', label: '\u041A\u0430\u0440\u0442\u044B \u043F\u043E\u0433\u043E\u0434\u044B', detail: '\u041D\u0435 \u043A\u044D\u0448\u0438\u0440\u043E\u0432\u0430\u043D\u044B (\u043E\u0444\u043B\u0430\u0439\u043D \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B)', action: 'maps-refresh' });
    } else if (mapsAnyStale && !mapsAllCachedFresh) {
      // Some cached maps are stale
      var newestMapFetch = 0;
      getWxMaps().forEach(function(map) {
        var cached = state.wxMapCache[map.url];
        if (cached && cached.fetchedAt && cached.fetchedAt > newestMapFetch) {
          newestMapFetch = cached.fetchedAt;
        }
      });
      warnings.push({ type: 'stale', icon: 'alert-triangle', label: '\u041A\u0430\u0440\u0442\u044B \u043F\u043E\u0433\u043E\u0434\u044B', detail: '\u0423\u0441\u0442\u0430\u0440\u0435\u043B\u0438 (' + formatRelativeTime(new Date(newestMapFetch).toISOString()) + ')', action: 'maps-refresh' });
    }

    // SIGMET status
    if (state.sigmetLoading) {
      warnings.push({ type: 'loading', icon: 'rotate-ccw', label: 'SIGMET', detail: '\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...', action: null });
    } else if (state.sigmetError && !state.sigmetCache) {
      warnings.push({ type: 'error', icon: 'alert-triangle', label: 'SIGMET', detail: state.sigmetError, action: 'sigmet-retry' });
    } else if (state.sigmetCache && isStale(state.sigmetCache.fetchedAt, SIGMET_STALE_MS)) {
      warnings.push({ type: 'stale', icon: 'alert-triangle', label: 'SIGMET', detail: '\u0423\u0441\u0442\u0430\u0440\u0435\u043B\u0438 (' + formatRelativeTime(new Date(state.sigmetCache.fetchedAt).toISOString()) + ')', action: 'sigmet-refresh' });
    } else if (!state.sigmetCache) {
      warnings.push({ type: 'missing', icon: 'cloud-lightning', label: 'SIGMET', detail: '\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445', action: 'sigmet-fetch' });
    }

    return warnings;
  }

  // ===== All Route Airports =====
  function getAllRouteAirports() {
    var airports = [];
    if (state.depIcao.length === 4) airports.push(state.depIcao);
    if (state.arrIcao.length === 4 && state.arrIcao !== state.depIcao) airports.push(state.arrIcao);
    state.altIcaos.forEach(function(icao) {
      if (airports.indexOf(icao) === -1) airports.push(icao);
    });
    return airports;
  }

  // ===== NOTAM Cache: localStorage persistence =====
  var STALE_MS = 30 * 60 * 1000; // 30 min — weather data older than this is considered stale
  var NOTAM_STALE_MS = 24 * 60 * 60 * 1000; // 24 hours — NOTAM data older than this is considered stale

  function isStale(timestamp, threshold) {
    if (!timestamp) return false;
    var ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    return Date.now() - ts > (threshold || STALE_MS);
  }

  function saveNotamCache() {
    try {
      var cacheToSave = {};
      var keys = Object.keys(state.notamCache);
      keys.forEach(function(icao) {
        var entry = state.notamCache[icao];
        if (entry && entry.fetchedAt) {
          cacheToSave[icao] = entry; // Save all — stale data is better than nothing
        }
      });
      localStorage.setItem('notam-cache', JSON.stringify(cacheToSave));
    } catch(e) {}
  }

  function loadNotamCache() {
    try {
      var stored = localStorage.getItem('notam-cache');
      if (stored) {
        var parsed = JSON.parse(stored);
        var keys = Object.keys(parsed);
        keys.forEach(function(icao) {
          var entry = parsed[icao];
          if (entry && entry.fetchedAt) {
            state.notamCache[icao] = entry; // Load all — stale data is better than nothing
          }
        });
      }
    } catch(e) {}
  }

  // ===== Weather Map Cache: IndexedDB persistence =====
  var WX_MAP_DB = 'wx-map-cache';
  var WX_MAP_STORE = 'maps';
  var _wxMapDb = null;

  function openWxMapDb() {
    if (_wxMapDb) return Promise.resolve(_wxMapDb);
    if (!('indexedDB' in window)) return Promise.reject('no IndexedDB');
    return new Promise(function(resolve, reject) {
      var req = indexedDB.open(WX_MAP_DB, 1);
      req.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(WX_MAP_STORE)) {
          db.createObjectStore(WX_MAP_STORE, { keyPath: 'url' });
        }
      };
      req.onsuccess = function(e) {
        _wxMapDb = e.target.result;
        resolve(_wxMapDb);
      };
      req.onerror = function() { reject('IndexedDB open error'); };
    });
  }

  function saveWxMapToDb(url, blob) {
    return openWxMapDb().then(function(db) {
      return new Promise(function(resolve) {
        try {
          var tx = db.transaction(WX_MAP_STORE, 'readwrite');
          var store = tx.objectStore(WX_MAP_STORE);
          store.put({ url: url, blob: blob, fetchedAt: Date.now() });
          tx.oncomplete = function() { resolve(); };
          tx.onerror = function() { resolve(); };
        } catch(e) { resolve(); }
      });
    }).catch(function() {});
  }

  function loadAllWxMapsFromDb() {
    return openWxMapDb().then(function(db) {
      return new Promise(function(resolve) {
        try {
          var tx = db.transaction(WX_MAP_STORE, 'readonly');
          var store = tx.objectStore(WX_MAP_STORE);
          var req = store.getAll();
          req.onsuccess = function() { resolve(req.result || []); };
          req.onerror = function() { resolve([]); };
        } catch(e) { resolve([]); }
      });
    }).catch(function() { return []; });
  }

  function initWxMapCache() {
    return loadAllWxMapsFromDb().then(function(entries) {
      entries.forEach(function(entry) {
        if (entry && entry.url && entry.blob) {
          var blobUrl = URL.createObjectURL(entry.blob);
          state.wxMapCache[entry.url] = {
            blobUrl: blobUrl,
            fetchedAt: entry.fetchedAt || 0
          };
        }
      });
    }).catch(function() {});
  }

  function fetchAndCacheWxMap(mapDef, forceRefresh) {
    var url = mapDef.url;
    var cached = state.wxMapCache[url];
    if (!forceRefresh && cached && cached.blobUrl && !isStale(cached.fetchedAt, WX_MAP_STALE_MS)) {
      return Promise.resolve();
    }
    // Use CORS proxy Worker for caching (direct fetch fails — no CORS headers from meteoinfo/NOAA)
    // Task 24: §5 — cache-busting (?_t=Date.now()) ЗАПРЕЩЁН в fetch. Инвалидация кэша —
    // ответственность SW (смена CACHE_NAME). forceRefresh обрабатывается через state.wxMapCache.
    var proxyUrl = AWC_PROXY_URL + '/wxmap?url=' + encodeURIComponent(url);
    return fetch(proxyUrl)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(function(blob) {
        if (cached && cached.blobUrl) {
          try { URL.revokeObjectURL(cached.blobUrl); } catch(e) {}
        }
        var blobUrl = URL.createObjectURL(blob);
        state.wxMapCache[url] = {
          blobUrl: blobUrl,
          fetchedAt: Date.now()
        };
        return saveWxMapToDb(url, blob);
      })
      .catch(function(err) {
        console.warn('[WxMap] Failed to fetch', url, ':', err.message);
      });
  }

  function fetchAllWxMaps(forceRefresh) {
    state.wxMapLoading = true;
    renderCurrentTab();
    var promises = getWxMaps().map(function(mapDef) {
      return fetchAndCacheWxMap(mapDef, forceRefresh);
    });
    return Promise.all(promises)
      .then(function() {
        state.wxMapLoading = false;
        renderCurrentTab();
      })
      .catch(function() {
        state.wxMapLoading = false;
        renderCurrentTab();
      });
  }

  // ===== Task 29: Wind-by-flight-level maps (FL100-FL390, +6h, area C) — metavia.ru =====
  // Source: metavia.ru (Авиаметтелеком) — https://www.metavia.ru/?pag=metaviaMaps&wafc=ruat&ind=C
  // 11 доступных уровней: FL100,140,180,210,240,270,300,320,340,360,390. Default FL340.
  // Worker /mv-windmap?level=FL — поддерживает PHPSESSID-сессию metavia.ru + кэш PNG (1h).
  // Клиент предзагружает все 11 уровней (батчами по 5), кэш в state.windMapCache.
  function getWindMapUrl(level) {
    var cfg = getWindMaps();
    if (!cfg || !AWC_PROXY_URL) return '';
    var ep = cfg.endpoint || '/mv-windmap';
    return AWC_PROXY_URL + ep + '?level=' + level;
  }

  function fetchAndCacheWindMap(level, forceRefresh) {
    var url = getWindMapUrl(level);
    if (!url) return Promise.resolve();
    var cached = state.windMapCache[level];
    if (!forceRefresh && cached && cached.blobUrl && !isStale(cached.fetchedAt, WX_MAP_STALE_MS)) {
      return Promise.resolve();
    }
    // Worker /mv-windmap возвращает PNG напрямую (с CORS + 1h кэш), без /wxmap обёртки.
    return fetch(url)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(function(blob) {
        if (cached && cached.blobUrl) {
          try { URL.revokeObjectURL(cached.blobUrl); } catch(e) {}
        }
        var blobUrl = URL.createObjectURL(blob);
        state.windMapCache[level] = { blobUrl: blobUrl, fetchedAt: Date.now() };
      })
      .catch(function(err) {
        console.warn('[WindMap] Failed to fetch FL' + level + ':', err.message);
      });
  }

  function preloadAllWindMaps(forceRefresh) {
    var cfg = getWindMaps();
    if (!cfg || !cfg.levels || cfg.levels.length === 0) return Promise.resolve();
    state.windMapLoading = true;
    renderCurrentTab();
    // Fetch in small concurrent batches (5 at a time) to avoid hammering the Worker
    var levels = cfg.levels.slice();
    var batches = [];
    for (var i = 0; i < levels.length; i += 5) {
      batches.push(levels.slice(i, i + 5));
    }
    var chain = Promise.resolve();
    batches.forEach(function(batch) {
      chain = chain.then(function() {
        return Promise.all(batch.map(function(lvl) {
          return fetchAndCacheWindMap(lvl, forceRefresh);
        }));
      });
    });
    return chain
      .then(function() {
        state.windMapLoading = false;
        renderCurrentTab();
        console.info('[WindMap] Preloaded', Object.keys(state.windMapCache).length, 'of', cfg.levels.length, 'levels');
      })
      .catch(function() {
        state.windMapLoading = false;
        renderCurrentTab();
      });
  }

  // ===== METAR History: fetched on demand from AWC proxy =====
  // Fetches last 2 hours of METAR observations via aviationweather.gov
  function fetchMetarHistory(icao) {
    if (!AWC_PROXY_URL) return Promise.resolve();
    state.metarHistoryLoading[icao] = true;
    renderCurrentTab();

    return fetch(AWC_PROXY_URL + '/metar?ids=' + icao + '&hours=2')
      .then(function(res) {
        if (!res.ok) throw new Error('AWC HTTP ' + res.status);
        return res.json();
      })
      .then(function(arr) {
        if (!Array.isArray(arr)) { return; }
        // AWC returns newest first; skip the first (current METAR), keep the rest
        var hist = [];
        for (var i = 1; i < arr.length; i++) {
          var item = arr[i];
          var raw = (item.rawOb || '').replace(/^(METAR|SPECI)\s+/i, '');
          if (!raw) continue;
          var obsTs = item.obsTime ? new Date(item.obsTime * 1000).toISOString() :
                      item.reportTime || '';
          hist.push({
            raw: raw,
            observedAt: obsTs,
            flightCat: item.fltCat || ''
          });
        }
        state.metarHistory[icao] = hist;
        console.info('[History] Fetched', hist.length, 'METAR for', icao);
      })
      .catch(function(err) {
        console.warn('[History] Failed for', icao, ':', err.message);
      })
      .then(function() {
        state.metarHistoryLoading[icao] = false;
        saveWxCache(); // Persist metarHistory to localStorage
        renderCurrentTab();
      });
  }

  function saveWxCache() {
    try {
      var cacheToSave = {};
      var keys = Object.keys(state.weatherCache);
      keys.forEach(function(icao) {
        var entry = state.weatherCache[icao];
        if (entry && entry.cachedAt) {
          // Include metarHistory for this ICAO if available
          var entryCopy = Object.assign({}, entry);
          if (state.metarHistory[icao] && state.metarHistory[icao].length > 0) {
            entryCopy.metarHistory = state.metarHistory[icao];
          }
          cacheToSave[icao] = entryCopy; // Save all — stale data is better than nothing
        }
      });
      localStorage.setItem('wx-cache', JSON.stringify(cacheToSave));
    } catch(e) {}
  }

  function loadWxCache() {
    try {
      var stored = localStorage.getItem('wx-cache');
      if (stored) {
        var parsed = JSON.parse(stored);
        var keys = Object.keys(parsed);
        keys.forEach(function(icao) {
          var entry = parsed[icao];
          if (entry && entry.cachedAt) {
            // Restore metarHistory if present
            if (entry.metarHistory && Array.isArray(entry.metarHistory)) {
              state.metarHistory[icao] = entry.metarHistory;
              delete entry.metarHistory; // Don't keep it in weatherCache entry
            }
            state.weatherCache[icao] = entry; // Load all — stale data is better than nothing
          }
        });
      }
    } catch(e) {}
  }

  function saveRouteInfo() {
    try {
      localStorage.setItem('wx-route', JSON.stringify({
        depIcao: state.depIcao,
        arrIcao: state.arrIcao,
        altIcaos: state.altIcaos,
        altInput: state.altInput
      }));
    } catch(e) {}
  }

  function loadRouteInfo() {
    try {
      var stored = localStorage.getItem('wx-route');
      if (stored) {
        var parsed = JSON.parse(stored);
        if (parsed.depIcao) state.depIcao = parsed.depIcao;
        if (parsed.arrIcao) state.arrIcao = parsed.arrIcao;
        if (parsed.altIcaos && Array.isArray(parsed.altIcaos)) state.altIcaos = parsed.altIcaos;
        if (parsed.altInput) state.altInput = parsed.altInput;
        else if (parsed.altIcaos && Array.isArray(parsed.altIcaos) && parsed.altIcaos.length > 0) state.altInput = parsed.altIcaos.join(', ');
      }
    } catch(e) {}
  }

  // ===== Weather API Fetch Functions =====
  // Priority chain: CheckWX (primary) → AVWX (fallback) for METAR/TAF/Station

  // ===== Station Cache: localStorage persistence with 24h TTL =====
  function saveStationCache() {
    try {
      var cache = {};
      var keys = Object.keys(state.avwxStation);
      keys.forEach(function(icao) {
        var s = state.avwxStation[icao];
        if (s) cache[icao] = { data: s, cachedAt: Date.now() };
      });
      localStorage.setItem('wx-stations', JSON.stringify(cache));
    } catch(e) {}
  }

  function loadStationCache() {
    try {
      var stored = localStorage.getItem('wx-stations');
      if (stored) {
        var parsed = JSON.parse(stored);
        var now = Date.now();
        var keys = Object.keys(parsed);
        keys.forEach(function(icao) {
          var entry = parsed[icao];
          if (entry && entry.data && (now - entry.cachedAt < STATION_TTL_MS)) {
            state.avwxStation[icao] = entry.data;
            if (entry.data.name) AIRPORT_NAMES[icao] = entry.data.name;
          }
        });
      }
    } catch(e) {}
  }

  // ===== API Error Toast Notifications =====
  function showApiError(type, detail) {
    var msg = '';
    if (type === 'rate_limit') msg = '\u26A0\uFE0F \u041B\u0438\u043C\u0438\u0442 API \u0438\u0441\u0447\u0435\u0440\u043F\u0430\u043D. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435.';
    else if (type === 'network') msg = '\u26A0\uFE0F \u041D\u0435\u0442 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F \u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u043E\u043C';
    else if (type === 'avwx_block') msg = '\u26A0\uFE0F AVWX: \u0430\u044D\u0440\u043E\u043F\u043E\u0440\u0442 \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D (' + detail + ')';
    else if (type === 'server_error') msg = '\u26A0\uFE0F \u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430: ' + detail;
    else if (type === 'no_data') msg = '\u26A0\uFE0F \u0414\u0430\u043D\u043D\u044B\u0435 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B';
    else msg = '\u26A0\uFE0F \u041E\u0448\u0438\u0431\u043A\u0430: ' + detail;
    if (window.app && window.app.showToast) window.app.showToast(msg);
  }

  function handleApiError(err, icao) {
    var msg = (err && err.message) || '';
    if (/429/.test(msg)) showApiError('rate_limit');
    else if (/Failed to fetch|NetworkError|Network request failed/.test(msg)) showApiError('network');
    else if (msg.indexOf(AVWX_BLOCK_MSG) !== -1) showApiError('avwx_block', icao);
    else if (/HTTP 5\d\d/.test(msg)) showApiError('server_error', msg.replace('HTTP ', ''));
  }

  // Fetch station info for airports (batch) — skips ICAOs already in cache
  // Priority: CheckWX (primary — timezone, batch support) → AVWX (fallback)
  function fetchAvwxStation(icaos) {
    if (!icaos || icaos.length === 0) return Promise.resolve();
    // Filter out ICAOs already in station cache
    var needFetch = icaos.filter(function(icao) { return !state.avwxStation[icao]; });
    if (needFetch.length === 0) return Promise.resolve();
    state.avwxStationLoading = true;
    renderCurrentTab();

    // Task 28: Worker /wx-station proxy (CheckWX primary → AVWX fallback, secrets in Worker env).
    // Worker handles the CheckWX→AVWX fallback internally. Client calls once per ICAO.
    return Promise.all(needFetch.map(function(icao) {
      return fetch(AWC_PROXY_URL + '/wx-station?icao=' + encodeURIComponent(icao))
        .then(function(res) {
          if (!res.ok) throw new Error('wx-station HTTP ' + res.status);
          return res.json();
        })
        .then(function(resp) {
          if (resp.error) throw new Error(resp.error);
          var provider = resp.provider; // 'CheckWX' | 'AVWX'
          var d = resp.data;
          if (!d) throw new Error('No station data');
          if (provider === 'CheckWX') {
            // CheckWX returns array — take first element
            var s = Array.isArray(d) ? d[0] : d;
            if (!s) throw new Error('Empty CheckWX station response');
            state.avwxStation[icao] = {
              city: s.city || '',
              country: (s.country && s.country.name) || '',
              elevation: s.elevation || null,
              latitude: s.latitude ? s.latitude.decimal : null,
              longitude: s.longitude ? s.longitude.decimal : null,
              name: s.name || AIRPORT_NAMES[icao] || icao,
              icao: icao,
              iata: s.iata || '',
              type: '',
              reporting: false,
              runways: [],
              timezone: (s.timeinfo && s.timeinfo.timezone) || '',
              utcOffset: (s.timeinfo && s.timeinfo.gmt_offset) || null,
              dstActive: (s.timeinfo && s.timeinfo.dst_active) || false
            };
            if (s.name) AIRPORT_NAMES[icao] = s.name;
          } else {
            // AVWX format
            if (d.error) throw new Error(d.error);
            state.avwxStation[icao] = {
              city: d.city || '',
              country: d.country || '',
              elevation: d.elevation_ft ? { feet: d.elevation_ft } : null,
              latitude: d.latitude || null,
              longitude: d.longitude || null,
              name: d.name || AIRPORT_NAMES[icao] || icao,
              icao: d.icao || icao,
              iata: d.iata || '',
              type: d.type || '',
              reporting: d.reporting || false,
              runways: d.runways || [],
              timezone: getIcaoTz(icao) || '',
              utcOffset: null,
              dstActive: false
            };
            if (d.name) AIRPORT_NAMES[icao] = d.name;
          }
        })
        .catch(function() {
          // Fallback: use AIRPORT_NAMES from JSON if available, else null
          if (!state.avwxStation[icao] && AIRPORT_NAMES[icao]) {
            state.avwxStation[icao] = { name: AIRPORT_NAMES[icao], icao: icao, city: '', country: '', iata: '', type: '', reporting: false, runways: [], elevation: null, latitude: null, longitude: null, timezone: getIcaoTz(icao) || '', utcOffset: null, dstActive: false };
          } else if (!state.avwxStation[icao]) {
            state.avwxStation[icao] = null;
          }
        });
    }))
    .then(function() {
      state.avwxStationLoading = false;
      saveStationCache();
      renderCurrentTab();
    });
  }

  // ===== avia-meteo.ru bulk text fetch (PRIMARY source — Task 28) =====
  // Fetches full metar.txt / taf.txt via Worker /am-metar, /am-taf (CORS + 5min cache).
  // Client parses the bulk text for route airports. Cached in state.amMetarBulk/amTafBulk (5 min).
  var AM_BULK_TTL_MS = 5 * 60 * 1000; // sync with Worker AM_CACHE_TTL

  function fetchAmMetarBulk(forceRefresh) {
    if (!AWC_PROXY_URL) return Promise.resolve(null);
    var cached = state.amMetarBulk;
    if (!forceRefresh && cached && (Date.now() - cached.fetchedAt) < AM_BULK_TTL_MS) {
      return Promise.resolve(cached.text);
    }
    state.amLoading = true;
    return fetch(AWC_PROXY_URL + '/am-metar')
      .then(function(res) {
        if (!res.ok) throw new Error('AM METAR HTTP ' + res.status);
        return res.text();
      })
      .then(function(text) {
        state.amMetarBulk = { text: text, fetchedAt: Date.now() };
        console.info('[AM] METAR bulk fetched:', text.length, 'bytes');
        return text;
      })
      .catch(function(err) {
        console.warn('[AM] METAR bulk fetch failed:', err.message);
        return null;
      })
      .then(function(text) {
        state.amLoading = false;
        return text;
      });
  }

  function fetchAmTafBulk(forceRefresh) {
    if (!AWC_PROXY_URL) return Promise.resolve(null);
    var cached = state.amTafBulk;
    if (!forceRefresh && cached && (Date.now() - cached.fetchedAt) < AM_BULK_TTL_MS) {
      return Promise.resolve(cached.text);
    }
    state.amLoading = true;
    return fetch(AWC_PROXY_URL + '/am-taf')
      .then(function(res) {
        if (!res.ok) throw new Error('AM TAF HTTP ' + res.status);
        return res.text();
      })
      .then(function(text) {
        state.amTafBulk = { text: text, fetchedAt: Date.now() };
        console.info('[AM] TAF bulk fetched:', text.length, 'bytes');
        return text;
      })
      .catch(function(err) {
        console.warn('[AM] TAF bulk fetch failed:', err.message);
        return null;
      })
      .then(function(text) {
        state.amLoading = false;
        return text;
      });
  }

  // Parse avia-meteo.ru metar.txt — one METAR per line, format "ICAO DDHHMMZ ...="
  // Returns: { ICAO: rawMetarString } for ICAOs in the icaos list (first occurrence wins).
  function parseAmMetarText(text, icaos) {
    var result = {};
    var icaoSet = {};
    icaos.forEach(function(icao) { icaoSet[icao.toUpperCase()] = true; });
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var m = line.match(/^([A-Z]{4})\s/);
      if (!m) continue;
      var icao = m[1];
      if (!icaoSet[icao]) continue;
      if (result[icao]) continue; // first occurrence wins
      var raw = line.replace(/=\s*$/, '').replace(/^(METAR|SPECI)\s+/i, '');
      result[icao] = raw;
    }
    return result;
  }

  // Parse avia-meteo.ru taf.txt — blocks separated by '=', each block starts with "ICAO DDHHMMZ ...".
  // Continuation lines (indented) are collapsed into one space-separated string.
  // Returns: { ICAO: rawTafString } for ICAOs in the icaos list (first occurrence wins).
  function parseAmTafText(text, icaos) {
    var result = {};
    var icaoSet = {};
    icaos.forEach(function(icao) { icaoSet[icao.toUpperCase()] = true; });
    var blocks = text.split('=');
    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b].replace(/^\s+|\s+$/g, '');
      if (!block) continue;
      // Collapse continuation lines (indented or wrapped) into one line
      var collapsed = block.replace(/\s*\n\s*/g, ' ');
      var m = collapsed.match(/^([A-Z]{4})\s/);
      if (!m) continue;
      var icao = m[1];
      if (!icaoSet[icao]) continue;
      if (result[icao]) continue; // first occurrence wins
      var raw = collapsed.replace(/^TAF\s+/i, '');
      result[icao] = raw;
    }
    return result;
  }

  // ===== Batched METAR Fetch =====
  // Task 28: avia-meteo.ru PRIMARY → Worker /wx-metar (CheckWX→AVWX) → AWC proxy (last resort)
  function fetchMetarBatch(icaos, forceRefresh) {
    if (!icaos || icaos.length === 0) return Promise.resolve();

    var needFetch = icaos;
    if (forceRefresh) {
      // Don't delete cache upfront — old METAR stays visible until new data arrives.
      // Clear only errors so retry isn't blocked by stale error state.
      icaos.forEach(function(icao) {
        delete state.wxErrors[icao];
      });
      needFetch = icaos;
    } else {
      // Skip airports that already have fresh data
      needFetch = icaos.filter(function(icao) {
        return !state.weatherCache[icao] || !state.weatherCache[icao].metar;
      });
    }
    if (needFetch.length === 0) return Promise.resolve();

    var fetchedThisCycle = {};
    needFetch.forEach(function(icao) { state.wxLoading[icao] = true; });
    renderCurrentTab();

    // Step 1: avia-meteo.ru PRIMARY — fetch bulk metar.txt once, parse for all needFetch
    return fetchAmMetarBulk(forceRefresh)
      .then(function(text) {
        if (!text) return;
        var parsed = parseAmMetarText(text, needFetch);
        for (var icao in parsed) {
          if (parsed.hasOwnProperty(icao)) {
            var raw = parsed[icao];
            var parsedMetar = parseMetar(raw);
            state.weatherCache[icao] = {
              icao: icao,
              airportName: AIRPORT_NAMES[icao] || icao,
              metar: raw,
              taf: (state.weatherCache[icao] && state.weatherCache[icao].taf) || '',
              parsed: parsedMetar,
              observedAt: new Date().toISOString(),
              station: state.avwxStation[icao] || (state.weatherCache[icao] && state.weatherCache[icao].station) || null,
              flight_rules: determineFlightRules(parsedMetar),
              source: 'avia-meteo',
              cachedAt: Date.now()
            };
            fetchedThisCycle[icao] = true;
            state.weatherLoaded = true;
          }
        }
        console.info('[AM] METAR parsed:', Object.keys(parsed).length, 'of', needFetch.length, 'ICAOs');
      })
      .then(function() {
        // Step 2: Worker /wx-metar fallback (CheckWX → AVWX, secrets in Worker env) for missing ICAOs
        var stillMissing = needFetch.filter(function(icao) { return !fetchedThisCycle[icao]; });
        if (stillMissing.length === 0) return;
        var batches = [];
        for (var i = 0; i < stillMissing.length; i += 25) {
          batches.push(stillMissing.slice(i, i + 25));
        }
        return Promise.all(batches.map(function(batch) {
          var icaoList = batch.join(',').toUpperCase();
          return fetch(AWC_PROXY_URL + '/wx-metar?ids=' + encodeURIComponent(icaoList))
            .then(function(res) {
              if (!res.ok) throw new Error('wx-metar HTTP ' + res.status);
              return res.json();
            })
            .then(function(resp) {
              // resp: { checkwx: { data: [...] }, avwxFallback: [{ icao, data }] }
              var grouped = {};
              if (resp.checkwx && Array.isArray(resp.checkwx.data)) {
                resp.checkwx.data.forEach(function(item) {
                  var raw = '';
                  var code = '';
                  if (typeof item === 'string') {
                    raw = item;
                  } else if (item) {
                    code = (item.icao || '').toUpperCase();
                    raw = item.raw_text || item.rawOb || '';
                  }
                  raw = raw.toString().replace(/^(METAR|SPECI)\s+/i, '');
                  if (!code && raw) {
                    var m = raw.match(/^([A-Z]{4})\s/);
                    if (m) code = m[1];
                  }
                  if (code && raw && !grouped[code]) {
                    grouped[code] = { raw: raw, flight_category: (item && item.flight_category) || '' };
                  }
                });
              }
              batch.forEach(function(icao) {
                var entry = grouped[icao.toUpperCase()];
                if (entry && entry.raw) {
                  var parsed2 = parseMetar(entry.raw);
                  state.weatherCache[icao] = {
                    icao: icao,
                    airportName: AIRPORT_NAMES[icao] || icao,
                    metar: entry.raw,
                    taf: (state.weatherCache[icao] && state.weatherCache[icao].taf) || '',
                    parsed: parsed2,
                    observedAt: new Date().toISOString(),
                    station: state.avwxStation[icao] || (state.weatherCache[icao] && state.weatherCache[icao].station) || null,
                    flight_rules: entry.flight_category || determineFlightRules(parsed2),
                    source: 'CheckWX',
                    cachedAt: Date.now()
                  };
                  fetchedThisCycle[icao] = true;
                  state.weatherLoaded = true;
                }
              });
              // AVWX fallback items (ICAOs missing from CheckWX)
              if (Array.isArray(resp.avwxFallback)) {
                resp.avwxFallback.forEach(function(fb) {
                  var fbIcao = (fb.icao || '').toUpperCase();
                  var d = fb.data;
                  if (!fbIcao || !d || d.error) return;
                  var rawMetar = (d.raw || '').replace(/^(METAR|SPECI)\s+/i, '');
                  if (rawMetar) {
                    state.weatherCache[fbIcao] = {
                      icao: fbIcao,
                      airportName: AIRPORT_NAMES[fbIcao] || (d.info && d.info.name) || fbIcao,
                      metar: rawMetar,
                      taf: (state.weatherCache[fbIcao] && state.weatherCache[fbIcao].taf) || '',
                      parsed: parseMetar(rawMetar),
                      observedAt: (d.time && d.time.dt) || new Date().toISOString(),
                      station: state.avwxStation[fbIcao] || d.info || (state.weatherCache[fbIcao] && state.weatherCache[fbIcao].station) || null,
                      flight_rules: d.flight_rules || 'VFR',
                      source: 'AVWX',
                      cachedAt: Date.now()
                    };
                    fetchedThisCycle[fbIcao] = true;
                    if (d.info) {
                      state.avwxStation[fbIcao] = d.info;
                      if (d.info.name) AIRPORT_NAMES[fbIcao] = d.info.name;
                    }
                    state.weatherLoaded = true;
                  }
                });
              }
            })
            .catch(function(err) {
              console.warn('[wx-metar] Worker fallback failed:', err.message);
            });
        }));
      })
      .then(function() {
        // Step 3: AWC proxy fallback (last resort) for any ICAOs still missing
        if (AWC_PROXY_URL) {
          var stillMissing2 = needFetch.filter(function(icao) { return !fetchedThisCycle[icao]; });
          if (stillMissing2.length > 0) {
            return fetchAwcFallback(stillMissing2, 'metar');
          }
        }
      })
      .then(function() {
        saveWxCache();
      })
      .catch(function() {})
      .then(function() {
        needFetch.forEach(function(icao) { state.wxLoading[icao] = false; });
        renderCurrentTab();
      });
  }

  // AWC proxy fallback — batch request to aviationweather.gov via Cloudflare Worker
  // Called when both CheckWX and AVWX fail for some ICAOs
  function fetchAwcFallback(icaos, type) {
    var ids = icaos.join(',').toUpperCase();
    var endpoint = type === 'taf' ? 'taf' : 'metar';
    console.info('[AWC] Trying fallback for', ids, '(' + endpoint + ')');

    return fetch(AWC_PROXY_URL + '/' + endpoint + '?ids=' + encodeURIComponent(ids))
      .then(function(res) {
        if (!res.ok) throw new Error('AWC HTTP ' + res.status);
        return res.json();
      })
      .then(function(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return;
        arr.forEach(function(item) {
          var icao = (item.icaoId || '').toUpperCase();
          if (!icao) return;

          if (type === 'metar') {
            var raw = (item.rawOb || '').replace(/^(METAR|SPECI)\s+/i, '');
            if (!raw) return;
            var flightCat = item.flightCateg || item.category || item.flight_category || '';
            var observedAt = item.obsTime || new Date().toISOString();

            if (state.weatherCache[icao]) {
              // Always overwrite METAR with fresh AWC data (TAF preserved)
              state.weatherCache[icao].metar = raw;
              state.weatherCache[icao].observedAt = observedAt;
              state.weatherCache[icao].flight_rules = flightCat;
              state.weatherCache[icao].source = 'AWC';
              state.weatherCache[icao].cachedAt = Date.now();
            } else {
              state.weatherCache[icao] = {
                icao: icao,
                airportName: AIRPORT_NAMES[icao] || icao,
                metar: raw,
                taf: '',
                parsed: null,
                observedAt: observedAt,
                station: state.avwxStation[icao] || null,
                flight_rules: flightCat,
                source: 'AWC',
                cachedAt: Date.now()
              };
            }
          } else {
            // TAF
            var rawTaf = (item.rawTaf || '').replace(/^TAF\s+/i, '');
            if (!rawTaf) return;

            if (state.weatherCache[icao]) {
              // Always overwrite TAF with fresh AWC data (METAR preserved)
              state.weatherCache[icao].taf = rawTaf;
              if (!state.weatherCache[icao].source || state.weatherCache[icao].source === 'AWC') {
                state.weatherCache[icao].source = 'AWC';
              }
            } else {
              state.weatherCache[icao] = {
                icao: icao,
                airportName: AIRPORT_NAMES[icao] || icao,
                metar: '',
                taf: rawTaf,
                parsed: null,
                observedAt: new Date().toISOString(),
                station: state.avwxStation[icao] || null,
                flight_rules: '',
                source: 'AWC',
                cachedAt: Date.now()
              };
            }
          }
          state.weatherLoaded = true;
        });
        console.info('[AWC] Fallback resolved for', arr.length, 'item(s)');
      })
      .catch(function(err) {
        console.warn('[AWC] Fallback failed:', err.message);
      });
  }

  // Determine flight rules from parsed METAR data
  function determineFlightRules(parsed) {
    if (!parsed) return 'VFR';
    var vis = parsed.visibility ? parsed.visibility.value : 9999;
    var ceil = 9999;
    if (parsed.clouds && parsed.clouds.length > 0) {
      parsed.clouds.forEach(function(c) {
        if (c.amount === 'BKN' || c.amount === 'OVC' || c.type === 'BKN' || c.type === 'OVC') {
          var height = c.base || c.height || 0;
          if (height < ceil) ceil = height;
        }
      });
    }
    // ICAO flight rules categories (visibility in meters, ceiling in feet)
    if (vis < 1000 || ceil < 200) return 'LIFR';
    if (vis < 1500 || ceil < 300) return 'IFR';
    if (vis < 5000 || ceil < 1000) return 'MVFR';
    return 'VFR';
  }

  // ===== Batched TAF Fetch =====
  // Uses CheckWX /v2/taf/{ICAO1,ICAO2,...} — single batch request
  function fetchTafBatch(icaos, forceRefresh) {
    if (!icaos || icaos.length === 0) return Promise.resolve();

    var needFetch = icaos;
    if (!forceRefresh) {
      // Skip airports that already have TAF data in cache
      needFetch = icaos.filter(function(icao) {
        return !state.weatherCache[icao] || !state.weatherCache[icao].taf;
      });
    }
    if (needFetch.length === 0) return Promise.resolve();

    var fetchedThisCycle = {};
    needFetch.forEach(function(icao) { state.wxLoading[icao] = true; });
    renderCurrentTab();

    // Step 1: avia-meteo.ru PRIMARY — fetch bulk taf.txt once, parse for all needFetch
    return fetchAmTafBulk(forceRefresh)
      .then(function(text) {
        if (!text) return;
        var parsed = parseAmTafText(text, needFetch);
        for (var icao in parsed) {
          if (parsed.hasOwnProperty(icao)) {
            var rawTaf = parsed[icao];
            if (state.weatherCache[icao]) {
              state.weatherCache[icao].taf = rawTaf;
              if (!state.weatherCache[icao].source || state.weatherCache[icao].source === 'AWC') {
                state.weatherCache[icao].source = 'avia-meteo';
              }
            } else {
              state.weatherCache[icao] = {
                icao: icao,
                airportName: AIRPORT_NAMES[icao] || icao,
                metar: '',
                taf: rawTaf,
                parsed: null,
                observedAt: new Date().toISOString(),
                station: state.avwxStation[icao] || null,
                flight_rules: 'VFR',
                source: 'avia-meteo',
                cachedAt: Date.now()
              };
            }
            fetchedThisCycle[icao] = true;
            state.weatherLoaded = true;
          }
        }
        console.info('[AM] TAF parsed:', Object.keys(parsed).length, 'of', needFetch.length, 'ICAOs');
      })
      .then(function() {
        // Step 2: Worker /wx-taf fallback (CheckWX → AVWX, secrets in Worker env) for missing ICAOs
        var stillMissing = needFetch.filter(function(icao) { return !fetchedThisCycle[icao]; });
        if (stillMissing.length === 0) return;
        var batches = [];
        for (var i = 0; i < stillMissing.length; i += 25) {
          batches.push(stillMissing.slice(i, i + 25));
        }
        return Promise.all(batches.map(function(batch) {
          var icaoList = batch.join(',').toUpperCase();
          return fetch(AWC_PROXY_URL + '/wx-taf?ids=' + encodeURIComponent(icaoList))
            .then(function(res) {
              if (!res.ok) throw new Error('wx-taf HTTP ' + res.status);
              return res.json();
            })
            .then(function(resp) {
              // resp: { checkwx: { data: [...] }, avwxFallback: [{ icao, data }] }
              var grouped = {};
              if (resp.checkwx && Array.isArray(resp.checkwx.data)) {
                resp.checkwx.data.forEach(function(item) {
                  var rawTaf = '';
                  var code = '';
                  if (typeof item === 'string') {
                    rawTaf = item;
                  } else if (item) {
                    code = (item.icao || '').toUpperCase();
                    rawTaf = item.raw_text || '';
                  }
                  rawTaf = rawTaf.toString().replace(/^TAF\s+/i, '');
                  if (!code && rawTaf) {
                    var m = rawTaf.match(/^([A-Z]{4})\s/);
                    if (m) code = m[1];
                  }
                  if (code && rawTaf && !grouped[code]) grouped[code] = rawTaf;
                });
              }
              batch.forEach(function(icao) {
                var tafRaw = grouped[icao.toUpperCase()] || '';
                if (tafRaw) {
                  if (state.weatherCache[icao]) {
                    state.weatherCache[icao].taf = tafRaw;
                  } else {
                    state.weatherCache[icao] = {
                      icao: icao,
                      airportName: AIRPORT_NAMES[icao] || icao,
                      metar: '',
                      taf: tafRaw,
                      parsed: null,
                      observedAt: new Date().toISOString(),
                      station: state.avwxStation[icao] || null,
                      flight_rules: 'VFR',
                      source: 'CheckWX',
                      cachedAt: Date.now()
                    };
                  }
                  fetchedThisCycle[icao] = true;
                }
              });
              // AVWX fallback items
              if (Array.isArray(resp.avwxFallback)) {
                resp.avwxFallback.forEach(function(fb) {
                  var fbIcao = (fb.icao || '').toUpperCase();
                  var d = fb.data;
                  if (!fbIcao || !d || d.error) return;
                  var rawTaf = (d.raw || '').replace(/^TAF\s+/i, '');
                  if (rawTaf) {
                    if (state.weatherCache[fbIcao]) {
                      state.weatherCache[fbIcao].taf = rawTaf;
                    } else {
                      state.weatherCache[fbIcao] = {
                        icao: fbIcao,
                        airportName: AIRPORT_NAMES[fbIcao] || (d.info && d.info.name) || fbIcao,
                        metar: '',
                        taf: rawTaf,
                        parsed: null,
                        observedAt: new Date().toISOString(),
                        station: d.info || state.avwxStation[fbIcao] || null,
                        flight_rules: 'VFR',
                        source: 'AVWX',
                        cachedAt: Date.now()
                      };
                    }
                    fetchedThisCycle[fbIcao] = true;
                    if (d.info) {
                      state.avwxStation[fbIcao] = d.info;
                      if (d.info.name) AIRPORT_NAMES[fbIcao] = d.info.name;
                    }
                  }
                });
              }
            })
            .catch(function(err) {
              console.warn('[wx-taf] Worker fallback failed:', err.message);
            });
        }));
      })
      .then(function() {
        // Step 3: AWC proxy fallback (last resort)
        if (AWC_PROXY_URL) {
          var stillMissingTaf = needFetch.filter(function(icao) { return !fetchedThisCycle[icao]; });
          if (stillMissingTaf.length > 0) {
            return fetchAwcFallback(stillMissingTaf, 'taf');
          }
        }
      })
      .then(function() {
        saveWxCache();
      })
      .catch(function() {})
      .then(function() {
        renderCurrentTab();
      });
  }

  // Refresh weather for a single airport
  // Used by per-airport refresh buttons on Брифинг and Погода tabs
  function refreshAirportWeather(icao) {
    state.wxLoading[icao] = true;
    delete state.wxErrors[icao];
    renderCurrentTab();

    return fetchMetarBatch([icao], true).then(function() {
      return fetchTafBatch([icao], true);
    }).then(function() {
      state.wxLoading[icao] = false;
      renderCurrentTab();
    }).catch(function() {
      state.wxLoading[icao] = false;
      renderCurrentTab();
    });
  }

  // ===== Unified refresh function =====
  function refreshAllWeather() {
    var allAirports = getAllRouteAirports().concat(state.extraAirports);

    if (allAirports.length > 0) {
      // Force refresh METAR + TAF for all airports (not stations)
      fetchMetarBatch(allAirports, true);
      fetchTafBatch(allAirports, true);

      // Force refresh METAR history (old data preserved until new arrives)
      allAirports.forEach(function(icao) {
        fetchMetarHistory(icao);
      });

      // Re-fetch NOTAM (old data preserved until new arrives)
      allAirports.forEach(function(icao) {
        fetchNotam(icao);
      });
    }

    // Force refresh weather maps
    fetchAllWxMaps(true);

    // Force refresh SIGMET
    fetchSigmetData(true);
  }

  // Fetch station+METAR+TAF for route airports (used after dep/arr input)
  // Also fetches NOTAM for route airports
  function fetchRouteWeather() {
    var dep = state.depIcao;
    var arr = state.arrIcao;
    var mainAirports = [];
    if (dep.length === 4) mainAirports.push(dep);
    if (arr.length === 4 && arr !== dep) mainAirports.push(arr);

    if (mainAirports.length > 0) {
      // Fetch station info (only for missing ones)
      fetchAvwxStation(mainAirports);
      // Fetch METAR + history batched
      fetchMetarBatch(mainAirports);
      // Fetch TAF batched
      fetchTafBatch(mainAirports);
      // Fetch NOTAM once for route airports
      mainAirports.forEach(function(icao) {
        if (!state.notamCache[icao] && !state.notamLoading[icao]) {
          fetchNotam(icao);
        }
      });
    }
  }

  // Fetch station+METAR+TAF for alternate airports
  // Also fetches NOTAM for alternate airports
  function fetchAltWeather() {
    var allAlt = state.altIcaos.filter(function(icao) { return icao.length === 4; });
    if (allAlt.length > 0) {
      fetchAvwxStation(allAlt);
      fetchMetarBatch(allAlt);
      fetchTafBatch(allAlt);
      // Fetch NOTAM once for alternate airports
      allAlt.forEach(function(icao) {
        if (!state.notamCache[icao] && !state.notamLoading[icao]) {
          fetchNotam(icao);
        }
      });
    }
  }

  // ===== NOTAM Fetch (kept separate from weather cache) =====

  // Helper: transform raw NOTAM objects from API into our internal format
  function transformNotams(notams, code) {
    var now = Date.now();
    return notams.map(function(n) {
      var text = n.text || n.icaoMessage || '';
      var endDateStr = n.endDate || '';
      var startDateStr = n.startDate || '';

      // Determine if still active
      var effectiveTo = parseNotamDate(endDateStr);
      var effectiveFrom = parseNotamDate(startDateStr);
      var status = 'active';
      if (effectiveTo) {
        try {
          var endMs = new Date(effectiveTo).getTime();
          if (endMs < now) status = 'expired';
        } catch(e) { /* keep active */ }
      }

      return {
        id: n.id || n.number || '',
        type: parseNotamType(text),
        icao: n.location || code,
        qcode: extractQCode(text),
        subject: parseSubject(text),
        description: parseDescription(text),
        fullText: text,
        criticality: classifyNotam(text),
        status: status,
        effectiveFrom: effectiveFrom || n.created || '',
        effectiveTo: effectiveTo,
        created: n.created || ''
      };
    });
  }

  // Fetch NOTAMs from the API for a single ICAO location, parse and decrypt
  // Uses CORS proxy Worker to avoid NetworkError on notams.online
  function fetchNotamRaw(location) {
    var fetchUrl = AWC_PROXY_URL + '/notam?location=' + encodeURIComponent(location);
    return fetch(fetchUrl)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function(text) {
        var jsonStr = xorDecrypt(text.trim());
        var parsed;
        try {
          parsed = JSON.parse(jsonStr);
        } catch(e) {
          throw new Error('\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0438 \u0434\u0430\u043D\u043D\u044B\u0445 NOTAM');
        }
        if (!parsed.success || !Array.isArray(parsed.notams)) {
          throw new Error('\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 NOTAM \u0434\u043B\u044F \u0434\u0430\u043D\u043D\u043E\u0433\u043E \u0430\u044D\u0440\u043E\u043F\u043E\u0440\u0442\u0430');
        }
        return parsed;
      });
  }

  function fetchNotam(icao) {
    // If already loading, skip
    if (state.notamLoading[icao]) return;

    state.notamLoading[icao] = true;
    delete state.notamErrors[icao];
    renderCurrentTab();

    var code = icao.toUpperCase();

    fetchNotamRaw(code)
      .then(function(parsed) {
        var notams = transformNotams(parsed.notams, code);

        // If no NOTAMs found for this airport, try FIR fallback
        if (notams.length === 0) {
          var firCode = getFirForAirport(code);
          if (firCode && firCode !== code) {
            return fetchNotamRaw(firCode).then(function(firParsed) {
              // Filter FIR NOTAMs that mention this airport
              var firNotams = firParsed.notams.filter(function(n) {
                var text = (n.text || n.icaoMessage || '').toUpperCase();
                return text.indexOf(code) !== -1;
              });
              var transformed = transformNotams(firNotams, code);
              // Mark as FIR-sourced
              transformed.forEach(function(nt) { nt.source = 'FIR ' + firCode; });
              return { notams: transformed, source: 'notams.online (FIR ' + firCode + ')' };
            }).catch(function() {
              // FIR fetch failed — just use empty result
              return { notams: notams, source: 'notams.online' };
            });
          }
        }
        return { notams: notams, source: 'notams.online' };
      })
      .then(function(result) {
        state.notamCache[icao] = {
          icao: code,
          notams: result.notams,
          source: result.source,
          fetchedAt: new Date().toISOString()
        };
        saveNotamCache();
      })
      .catch(function(err) {
        state.notamErrors[icao] = err.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438';
      })
      .then(function() {
        state.notamLoading[icao] = false;
        renderCurrentTab();
      });
  }

  // ===== Targeted DOM Update Helpers (avoid re-rendering inputs) =====
  function updateRouteHints() {
    var depGroup = document.getElementById('depIcaoInput');
    var arrGroup = document.getElementById('arrIcaoInput');
    if (depGroup) {
      var parent = depGroup.closest('.metbriefing-input-group');
      var hint = parent ? parent.querySelector('.metbriefing-input-hint') : null;
      if (state.depIcao.length === 4 && AIRPORT_NAMES[state.depIcao]) {
        if (hint) { hint.textContent = AIRPORT_NAMES[state.depIcao]; }
        else if (parent) { var s = document.createElement('span'); s.className = 'metbriefing-input-hint'; s.textContent = AIRPORT_NAMES[state.depIcao]; parent.appendChild(s); }
      } else {
        if (hint) hint.remove();
      }
    }
    if (arrGroup) {
      var parent = arrGroup.closest('.metbriefing-input-group');
      var hint = parent ? parent.querySelector('.metbriefing-input-hint') : null;
      if (state.arrIcao.length === 4 && AIRPORT_NAMES[state.arrIcao]) {
        if (hint) { hint.textContent = AIRPORT_NAMES[state.arrIcao]; }
        else if (parent) { var s = document.createElement('span'); s.className = 'metbriefing-input-hint'; s.textContent = AIRPORT_NAMES[state.arrIcao]; parent.appendChild(s); }
      } else {
        if (hint) hint.remove();
      }
    }
    // Task 30: под инпутом ЗАПАСНЫЕ — названия аэропортов (как под ВЫЛЕТ/ПОСАДКА)
    var altGroup = document.getElementById('altIcaoInput');
    if (altGroup) {
      var altParent = altGroup.closest('.metbriefing-input-group');
      var altHint = altParent ? altParent.querySelector('.metbriefing-input-hint') : null;
      var altNames = state.altIcaos
        .filter(function(icao) { return AIRPORT_NAMES[icao]; })
        .map(function(icao) { return AIRPORT_NAMES[icao]; });
      if (altNames.length > 0) {
        var altText = altNames.join(', ');
        if (altHint) { altHint.textContent = altText; }
        else if (altParent) { var altSpan = document.createElement('span'); altSpan.className = 'metbriefing-input-hint'; altSpan.textContent = altText; altParent.appendChild(altSpan); }
      } else {
        if (altHint) altHint.remove();
      }
    }
  }

  function updateRouteDisplay() {
    var display = document.querySelector('.metbriefing-route-display');
    if (!display) return;
    // Task 30: ALT — на второй строке под красной частью маршрута
    var altLine = '';
    if (state.altIcaos.length > 0) {
      altLine = '<div class="metbriefing-route-alt">ALT: ' + state.altIcaos.join(', ') + '</div>';
    }
    display.innerHTML = '<div class="metbriefing-route-main">' +
        '<span class="metbriefing-route-code">' + (state.depIcao || '----') + '</span>' +
        '<span class="metbriefing-route-line"><span class="metbriefing-route-dots"></span>' + icon('plane', 18, 'metbriefing-route-plane') + '<span class="metbriefing-route-dots"></span></span>' +
        '<span class="metbriefing-route-code">' + (state.arrIcao || '----') + '</span>' +
      '</div>' + altLine;
  }

  // ===== Render: Route Card =====
  function renderRouteCard() {
    var el = document.getElementById('metbriefing-route-card');
    if (!el) return;

    var hintDep = state.depIcao.length === 4 && AIRPORT_NAMES[state.depIcao]
      ? '<span class="metbriefing-input-hint">' + AIRPORT_NAMES[state.depIcao] + '</span>' : '';
    var hintArr = state.arrIcao.length === 4 && AIRPORT_NAMES[state.arrIcao]
      ? '<span class="metbriefing-input-hint">' + AIRPORT_NAMES[state.arrIcao] + '</span>' : '';
    // Task 30: под инпутом ЗАПАСНЫЕ — названия аэропортов (как под ВЫЛЕТ/ПОСАДКА)
    var altNames = state.altIcaos
      .filter(function(icao) { return AIRPORT_NAMES[icao]; })
      .map(function(icao) { return AIRPORT_NAMES[icao]; });
    var hintAlt = altNames.length > 0
      ? '<span class="metbriefing-input-hint">' + altNames.join(', ') + '</span>' : '';

    // Task 30: ALT — на второй строке под красной частью маршрута
    var altLine = '';
    if (state.altIcaos.length > 0) {
      altLine = '<div class="metbriefing-route-alt">ALT: ' + state.altIcaos.join(', ') + '</div>';
    }

    el.innerHTML =
      '<div class="metbriefing-section-title">' + icon('map', 18) + '<span>\u041C\u0430\u0440\u0448\u0440\u0443\u0442</span></div>' +
      '<div class="metbriefing-route-display">' +
        '<div class="metbriefing-route-main">' +
          '<span class="metbriefing-route-code">' + (state.depIcao || '----') + '</span>' +
          '<span class="metbriefing-route-line"><span class="metbriefing-route-dots"></span>' + icon('plane', 18, 'metbriefing-route-plane') + '<span class="metbriefing-route-dots"></span></span>' +
          '<span class="metbriefing-route-code">' + (state.arrIcao || '----') + '</span>' +
        '</div>' +
        altLine +
      '</div>' +
      '<div class="metbriefing-route-inputs">' +
        '<div class="metbriefing-input-group metbriefing-input-group--short"><label class="metbriefing-input-label">\u0412\u044B\u043B\u0435\u0442</label>' +
          '<input type="text" class="metbriefing-icao-input metbriefing-icao-input--short" id="depIcaoInput" placeholder="ICAO" value="' + state.depIcao + '" maxlength="4" autocomplete="off" inputmode="text" autocapitalize="characters">' +
          hintDep +
        '</div>' +
        '<div class="metbriefing-input-group metbriefing-input-group--short"><label class="metbriefing-input-label">\u041F\u043E\u0441\u0430\u0434\u043A\u0430</label>' +
          '<input type="text" class="metbriefing-icao-input metbriefing-icao-input--short" id="arrIcaoInput" placeholder="ICAO" value="' + state.arrIcao + '" maxlength="4" autocomplete="off" inputmode="text" autocapitalize="characters">' +
          hintArr +
        '</div>' +
        '<div class="metbriefing-input-group metbriefing-input-group--alt"><label class="metbriefing-input-label">\u0417\u0430\u043F\u0430\u0441\u043D\u044B\u0435</label>' +
          '<input type="text" class="metbriefing-icao-input" id="altIcaoInput" placeholder="UUWW, UUDD" value="' + state.altInput + '" autocomplete="off" inputmode="text" autocapitalize="characters" pattern="[A-Z, ]*">' +
          hintAlt +
        '</div>' +
      '</div>';

    // Bind events
    var depEl = document.getElementById('depIcaoInput');
    var arrEl = document.getElementById('arrIcaoInput');
    var altEl = document.getElementById('altIcaoInput');

    if (depEl) depEl.addEventListener('input', function(e) {
      state.depIcao = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      e.target.value = state.depIcao;
      onRouteChange();
      updateRouteHints();
      updateRouteDisplay();
      // Обновить SIGMET-блок — FIR пересчитывается из текущего маршрута
      renderCurrentTab();
      // When dep or arr is entered, fetch station+summary
      if (state.depIcao.length === 4 || state.arrIcao.length === 4) {
        fetchRouteWeather();
      }
    });
    if (arrEl) arrEl.addEventListener('input', function(e) {
      state.arrIcao = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      e.target.value = state.arrIcao;
      onRouteChange();
      updateRouteHints();
      updateRouteDisplay();
      // Обновить SIGMET-блок — FIR пересчитывается из текущего маршрута
      renderCurrentTab();
      // When dep or arr is entered, fetch station+summary
      if (state.depIcao.length === 4 || state.arrIcao.length === 4) {
        fetchRouteWeather();
      }
    });
    if (altEl) {
      altEl.addEventListener('input', function(e) {
        state.altInput = e.target.value.toUpperCase().replace(/[^A-Z,\s]/g, '');
        e.target.value = state.altInput;
        saveRouteInfo();
        var lastPart = state.altInput.split(',').pop().trim();
        if (lastPart.length === 4 && /^[A-Z]{4}$/.test(lastPart)) {
          processAltInput();
        }
      });
      altEl.addEventListener('blur', processAltInput);
      altEl.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); processAltInput(); } });
    }
  }

  function processAltInput() {
    // Task 25 (Правка C): replace вместо concat + очистка при пустом вводе —
    // если аэродрома нет в инпутах, то и погоду для него больше не запрашиваем.
    if (!state.altInput.trim()) {
      state.altIcaos = [];
      onRouteChange(); saveRouteInfo(); renderRouteCard(); renderCurrentTab();
      return;
    }
    var codes = state.altInput.split(',').map(function(c) { return c.trim().toUpperCase(); })
      .filter(function(c) { return c.length === 4 && /^[A-Z]{4}$/.test(c); });
    state.altIcaos = codes;
    state.altInput = codes.join(', ');
    onRouteChange(); saveRouteInfo(); renderRouteCard(); renderCurrentTab();
    // Fetch station+summary for all alternate airports on blur
    if (state.altIcaos.length > 0) {
      fetchAltWeather();
    }
  }

  // ===== Tab Switcher =====
  function renderTabSwitcher() {
    var el = document.getElementById('metbriefing-tab-switcher');
    if (!el) return;
    el.innerHTML =
      '<button class="metbriefing-tab-pill ' + (state.activeTab === 'briefing' ? 'metbriefing-tab-pill--active' : '') + '" data-tab="briefing">\u0411\u0440\u0438\u0444\u0438\u043D\u0433</button>' +
      '<button class="metbriefing-tab-pill ' + (state.activeTab === 'weather' ? 'metbriefing-tab-pill--active' : '') + '" data-tab="weather">\u041F\u043E\u0433\u043E\u0434\u0430</button>' +
      '<button class="metbriefing-tab-pill ' + (state.activeTab === 'notam' ? 'metbriefing-tab-pill--active' : '') + '" data-tab="notam">NOTAM</button>';
  }

  // ===== Render: Current Tab =====
  function renderCurrentTab() {
    var el = document.getElementById('metbriefing-tab-content');
    if (!el) return;

    if (state.activeTab === 'briefing') renderBriefingTab(el);
    else if (state.activeTab === 'weather') renderWeatherTab(el);
    else if (state.activeTab === 'notam') renderNotamTab(el);
  }

  // ===== Render: Briefing Tab =====
  function renderBriefingTab(el) {
    var readiness = getReadiness();
    var allAirports = getAllRouteAirports();

    // NOTAM is already fetched when airports are entered — just render from cache

    var html = '';

    // Inline Weather — only show cached data
    if (allAirports.length > 0) {
      html += '<div class="metbriefing-status-section metbriefing-status-section--full-bleed">' +
        '<div class="metbriefing-section-title">' + icon('cloud', 18) + '<span>\u041F\u043E\u0433\u043E\u0434\u0430 \u043F\u043E \u043C\u0430\u0440\u0448\u0440\u0443\u0442\u0443</span></div>' +
        '<div class="metbriefing-inline-weather-list">';

      allAirports.forEach(function(icao) {
        var wxData = state.weatherCache[icao];
        var wxLoading = state.wxLoading[icao];
        var wxError = state.wxErrors[icao];
        var isNight = isNightAtAirport(icao);
        var flightRules = (wxData && wxData.flight_rules) || null;
        var borderClass = getFlightRulesBorderClass(flightRules);

        html += '<div class="metbriefing-inline-weather ' + borderClass + '" data-wx-goto-tab="weather" data-wx-goto-icao="' + icao + '" role="button" tabindex="0" aria-label="\u041F\u043E\u0434\u0440\u043E\u0431\u043D\u043E\u0441\u0442\u0438 \u043F\u043E\u0433\u043E\u0434\u044B ' + icao + '">';
        // Header
        var stationLine = '';
        var stationInfo = state.avwxStation[icao] || (wxData && wxData.station);
        if (stationInfo) {
          var parts = [];
          if (stationInfo.city) parts.push(escapeHtml(stationInfo.city + (stationInfo.country ? ', ' + (typeof stationInfo.country === 'string' ? stationInfo.country : stationInfo.country.name || '') : '')));
          if (stationInfo.elevation) {
            var elevVal = (typeof stationInfo.elevation === 'object' && stationInfo.elevation.feet) ? stationInfo.elevation.feet : (typeof stationInfo.elevation === 'number' ? stationInfo.elevation : null);
            if (elevVal !== null) parts.push(Math.round(elevVal) + ' ft');
          }
          var utcOff = stationInfo.utcOffset !== null && stationInfo.utcOffset !== undefined ? stationInfo.utcOffset : stationInfo.gmtOffset;
          if (utcOff !== null && utcOff !== undefined) {
            var offStr = 'UTC' + (utcOff >= 0 ? '+' : '') + (utcOff % 1 === 0 ? utcOff : utcOff.toFixed(1));
            if (stationInfo.dstActive) offStr += ' DST';
            parts.push(offStr);
          }
          stationLine = parts.length > 0 ? '<span class="metbriefing-inline-weather-station">' + parts.join(' \u00B7 ') + '</span>' : '';
        }

        html += '<div class="metbriefing-inline-weather-header">' +
          '<div class="metbriefing-inline-weather-airport">' +
            '<span class="metbriefing-inline-weather-icao">' + icao + '</span>' +
            (wxData && wxData.airportName ? '<span class="metbriefing-inline-weather-name">' + escapeHtml(wxData.airportName) + '</span>' : '') +
            stationLine +
          '</div>' +
          '<div class="metbriefing-inline-weather-actions">' +
            (flightRules ? '<span class="metbriefing-inline-weather-fr ' + getFlightRulesClass(flightRules) + '">' + getFlightRulesLabel(flightRules) + '</span>' : '') +
            (wxData && isStale(wxData.cachedAt) ? '<span class="metbriefing-stale-badge">' + icon('alert-triangle', 10) + '</span>' : '') +
            '<span class="metbriefing-inline-weather-daynight">' + icon(isNight ? 'moon' : 'sun', 14) + '</span>' +
            '<button class="metbriefing-inline-weather-refresh" data-wx-refresh="' + icao + '" aria-label="\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043F\u043E\u0433\u043E\u0434\u0443"' + (wxLoading ? ' disabled' : '') + '>' +
              icon('rotate-ccw', 14, wxLoading ? 'metbriefing-spin' : '') +
            '</button>' +
            icon('chevron-right', 14, 'metbriefing-inline-weather-chevron') +
          '</div>' +
        '</div>';

        // Loading
        if (wxLoading && !wxData) {
          html += '<div class="metbriefing-inline-loading">' + icon('rotate-ccw', 18, 'metbriefing-spin') + '<span>\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...</span></div>';
        }
        // Error (only show if no data)
        if (wxError && !wxData) {
          html += '<div class="metbriefing-inline-error">' + icon('alert-triangle', 14) + '<span>' + wxError + '</span>' +
            '<button class="metbriefing-inline-retry" data-wx-retry="' + icao + '">\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C</button></div>';
        }
        // No cached data — show hint
        if (!wxData && !wxLoading && !wxError) {
          html += '<div class="metbriefing-inline-loading" style="color:var(--color-text-muted)">' + icon('cloud', 18) + '<span>\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u0432\u043A\u043B\u0430\u0434\u043A\u0443 \u00AB\u041F\u043E\u0433\u043E\u0434\u0430\u00BB \u0434\u043B\u044F \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438</span></div>';
        }
        // Data
        if (wxData) {
          // Defense-in-depth: if parsed is null but we have raw METAR, parse it now
          if (!wxData.parsed && wxData.metar) {
            wxData.parsed = parseMetar(wxData.metar);
          }
          // Key fields (always visible)
          if (wxData.parsed) {
            html += '<div class="metbriefing-inline-weather-fields">' +
              '<div class="metbriefing-inline-field">' + icon('wind', 14, 'metbriefing-inline-field-icon') +
                '<span class="metbriefing-inline-field-value ' + getWindClass(wxData.parsed.wind) + '">' + formatWind(wxData.parsed.wind) + '</span></div>' +
              '<div class="metbriefing-inline-field">' + icon('eye', 14, 'metbriefing-inline-field-icon') +
                '<span class="metbriefing-inline-field-value ' + getWxVisibilityClass(wxData.parsed.visibility ? wxData.parsed.visibility.value : null) + '">' + formatBriefVis(wxData.parsed.visibility) + '</span></div>' +
              '<div class="metbriefing-inline-field">' + icon('thermometer', 14, 'metbriefing-inline-field-icon') +
                '<span class="metbriefing-inline-field-value">' + formatTemp(wxData.parsed.temperature) + '</span></div>' +
              '<div class="metbriefing-inline-field">' + icon('gauge', 14, 'metbriefing-inline-field-icon') +
                '<span class="metbriefing-inline-field-value">' + formatQNH(wxData.parsed.qnh) + '</span></div>' +
            '</div>';

            // Phenomena
            if (wxData.parsed.weather && wxData.parsed.weather.length > 0) {
              html += '<div class="metbriefing-inline-phenomena">';
              wxData.parsed.weather.forEach(function(wx) {
                html += '<span class="metbriefing-inline-phenomenon">' + icon(getWeatherIconName(wx), 12) + wx + '</span>';
              });
              html += '</div>';
            }

            // Clouds — use icon based on most significant cloud layer
            if (wxData.parsed.clouds && wxData.parsed.clouds.length > 0) {
              var maxCloudAmount = 'FEW';
              var cloudOrder = ['FEW', 'SCT', 'BKN', 'OVC'];
              wxData.parsed.clouds.forEach(function(c) {
                if (cloudOrder.indexOf(c.amount) > cloudOrder.indexOf(maxCloudAmount)) {
                  maxCloudAmount = c.amount;
                }
              });
              html += '<div class="metbriefing-inline-clouds">' + icon(getCloudIconName(maxCloudAmount), 12) + '<span>' + formatCloudsBrief(wxData.parsed.clouds) + '</span></div>';
            }
          }
        }
        html += '</div>';
      });
      html += '</div></div>';
    }

    // SIGMET — опасные явления
    var allSigmets = state.sigmetCache ? (state.sigmetCache.intl || []).concat(state.sigmetCache.us || []) : [];
    var routeFirIds = getRouteFirIds();
    var routeSigmets = filterSigmetsForRoute(allSigmets, routeFirIds);
    var filteredSigmets;
    var firFilterLabel;

    if (state.sigmetFirFilter === 'route') {
      filteredSigmets = routeSigmets;
      firFilterLabel = 'FIR маршрута';
    } else if (state.sigmetFirFilter === 'all') {
      filteredSigmets = allSigmets;
      firFilterLabel = 'Все SIGMET';
    } else if (state.sigmetFirFilter && state.sigmetFirFilter.indexOf('__country__') === 0) {
      // Country filter: show all SIGMET for FIRs of that country
      var countryName = state.sigmetFirFilter.substring('__country__'.length);
      var countryFirIds = [];
      if (state.firsData) {
        state.firsData.forEach(function(f) {
          if (f.country === countryName) countryFirIds.push(f.firId);
        });
      }
      filteredSigmets = allSigmets.filter(function(s) {
        return s.firId && countryFirIds.indexOf(s.firId) !== -1;
      });
      firFilterLabel = countryName;
    } else {
      // Single FIR filter
      filteredSigmets = allSigmets.filter(function(s) { return s.firId === state.sigmetFirFilter; });
      firFilterLabel = state.sigmetFirFilter;
    }

    // Helper: render SIGMET cards HTML
    function renderSigmetCards(sigmets, idxOffset) {
      var cardsHtml = '<div class="metbriefing-sigmet-list">';
      sigmets.forEach(function(s, i) {
        var idx = idxOffset + i;
        var sigmetNum = idxOffset + i + 1;
        var hazard = s.hazard || s.hazardType || '';
        var hazardLower = hazard.toLowerCase();
        var hazardClass = '';
        if (hazardLower.indexOf('ts') !== -1 || hazardLower.indexOf('convective') !== -1) hazardClass = 'ts';
        else if (hazardLower.indexOf('turb') !== -1) hazardClass = 'turb';
        else if (hazardLower.indexOf('ice') !== -1 || hazardLower.indexOf('icing') !== -1) hazardClass = 'ice';
        else if (hazardLower.indexOf('va') !== -1 || hazardLower.indexOf('volcanic') !== -1) hazardClass = 'va';
        else if (hazardLower.indexOf('mtw') !== -1 || hazardLower.indexOf('mountain') !== -1) hazardClass = 'mtw';
        // FIR name: use local data first, then fallback to firName from API
        var firName = '';
        if (state.firsData) {
          for (var fi = 0; fi < state.firsData.length; fi++) {
            if (state.firsData[fi].firId === s.firId) { firName = state.firsData[fi].nameRu; break; }
          }
        }
        if (!firName && s.firName) {
          var apiName = s.firName.replace(s.firId, '').trim();
          if (apiName) firName = apiName.charAt(0) + apiName.slice(1).toLowerCase();
        }
        var firDisplay = s.firId || '';
        if (firName) firDisplay = s.firId + ' (' + firName + ')';
        // Raw text for toggle
        var rawText = s.rawSigmet || '';
        // Tags: geom, movement, change
        var tagsHtml = '';
        var tags = [];
        if (s.geom) tags.push(s.geom);
        if (s.dir && s.dir !== '-' && s.dir !== 'None') {
          var movLabel = 'MOV ' + s.dir;
          if (s.spd && s.spd !== 0 && s.spd !== '0') movLabel += ' ' + s.spd + 'KT';
          tags.push(movLabel);
        }
        if (s.chng && s.chng !== 'None') tags.push(s.chng);
        if (tags.length > 0) {
          tagsHtml = '<span class="metbriefing-sigmet-tags">' + tags.map(function(t) {
            return '<span class="metbriefing-sigmet-tag">' + t + '</span>';
          }).join('') + '</span>';
        }
        // Build horizontal row: hazard + qualifier + FIR + #N | tags | level + valid
        var rowLeft = '<span class="metbriefing-sigmet-hazard-icon">' + icon(getHazardIcon(hazard), 18) + '</span>' +
          '<span class="metbriefing-sigmet-hazard-label">' + getHazardLabel(hazard) + '</span>' +
          (s.qualifier ? '<span class="metbriefing-sigmet-qualifier">' + s.qualifier + '</span>' : '') +
          '<span class="metbriefing-sigmet-card-fir">' + firDisplay + '</span>' +
          '<span class="metbriefing-sigmet-num">#' + sigmetNum + '</span>' +
          '<span class="metbriefing-sigmet-row-break"></span>';
        var rowCenter = tagsHtml;
        var rowRight = '';
        if (s.level || s.top || s.base) {
          rowRight += '<span class="metbriefing-sigmet-detail">' + icon('gauge', 12) +
            (s.base ? formatFlLevel(s.base) + '\u2014' : '') +
            (s.top ? formatFlLevel(s.top) : (s.level ? formatFlLevel(s.level) : '\u2014')) + '</span>';
        }
        if (s.type) {
          rowRight += '<span class="metbriefing-sigmet-detail">' + s.type + '</span>';
        }
        if (s.validFrom || s.validTo) {
          rowRight += '<span class="metbriefing-sigmet-valid">' + icon('clock', 12) +
            (s.validFrom || '\u2014') + ' \u2014 ' + (s.validTo || '\u2014') + '</span>';
        }
        cardsHtml += '<div class="metbriefing-sigmet-card metbriefing-sigmet-hazard--' + (hazardClass || 'default') + '">' +
          '<div class="metbriefing-sigmet-card-row">' +
            rowLeft +
            rowCenter +
            (rowRight ? rowRight : '') +
          '</div>' +
          (rawText ? '<div class="metbriefing-sigmet-raw-toggle" data-sigmet-raw-toggle="' + idx + '">Исходный текст</div>' +
            '<div class="metbriefing-sigmet-raw" data-sigmet-raw="' + idx + '">' + rawText.replace(/</g, '&lt;') + '</div>' : '') +
        '</div>';
      });
      cardsHtml += '</div>';
      return cardsHtml;
    }

    // Build FIR dropdown options: countries with clickable headers
    var firOptionsHtml = '';
    firOptionsHtml += '<option value="route"' + (state.sigmetFirFilter === 'route' ? ' selected' : '') + '>FIR маршрута (' + routeSigmets.length + ')</option>';
    firOptionsHtml += '<option disabled>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</option>';
    // Countries with clickable country headers + indented FIRs
    if (state.firsData && state.firsData.length > 0) {
      var countryMap = {};
      state.firsData.forEach(function(f) {
        if (!countryMap[f.country]) countryMap[f.country] = [];
        countryMap[f.country].push(f);
      });
      var countryNames = Object.keys(countryMap).sort();
      countryNames.forEach(function(cn) {
        var countryFirs = countryMap[cn];
        var countryCount = 0;
        countryFirs.forEach(function(f) {
          countryCount += allSigmets.filter(function(s) { return s.firId === f.firId; }).length;
        });
        // Clickable country option
        firOptionsHtml += '<option value="__country__' + cn + '"' + (state.sigmetFirFilter === '__country__' + cn ? ' selected' : '') + '>' + cn + ' (' + countryCount + ')</option>';
        // Indented FIRs under country
        countryFirs.forEach(function(f) {
          var fCount = allSigmets.filter(function(s) { return s.firId === f.firId; }).length;
          firOptionsHtml += '<option value="' + f.firId + '"' + (state.sigmetFirFilter === f.firId ? ' selected' : '') + '>\u00A0\u00A0' + f.firId + ' \u2014 ' + f.nameRu + ' (' + fCount + ')</option>';
        });
      });
    }
    firOptionsHtml += '<option value="all"' + (state.sigmetFirFilter === 'all' ? ' selected' : '') + '>Показать все (' + allSigmets.length + ')</option>';

    // Render SIGMET section
    html += '<div class="metbriefing-status-section metbriefing-status-section--full-bleed">' +
      '<div class="metbriefing-section-title">' + icon('cloud-lightning', 18) + '<span>SIGMET — опасные явления</span>' +
      (state.sigmetLoading ? ' <span class="metbriefing-sigmet-refreshing">' + icon('rotate-ccw', 14, 'metbriefing-spin') + '</span>' : '') +
      (state.sigmetCache && isStale(state.sigmetCache.fetchedAt, SIGMET_STALE_MS) ? ' <span class="metbriefing-stale-badge">' + icon('alert-triangle', 10) + '</span>' : '') +
      '</div>';

    // Error (no cache)
    if (state.sigmetError && !state.sigmetCache) {
      html += '<div class="metbriefing-sigmet-empty">' + icon('alert-triangle', 14) + '<span>' + state.sigmetError + '</span>' +
        '<button class="metbriefing-inline-retry" data-sigmet-retry>Повторить</button></div>';
    }
    // Loading (no cache)
    else if (state.sigmetLoading && !state.sigmetCache) {
      html += '<div class="metbriefing-sigmet-empty">' + icon('rotate-ccw', 14, 'metbriefing-spin') + '<span>Загрузка SIGMET...</span></div>';
    }
    else {
      // Route SIGMET display (above dropdown, when filter = 'route')
      if (state.sigmetFirFilter === 'route') {
        // Show route FIR list
        if (routeFirIds.length > 0) {
          html += '<div class="metbriefing-sigmet-route-firs">FIR: ' + routeFirIds.join(', ') + '</div>';
        }
        // Route SIGMET cards or "not found" message
        if (routeSigmets.length === 0) {
          var routeEmptyMsg = routeFirIds.length > 0 ? 'SIGMET по маршруту не обнаружены' : 'Добавьте аэропорты для проверки SIGMET';
          html += '<div class="metbriefing-sigmet-empty metbriefing-sigmet-empty--ok">' + icon('check-circle', 14) + '<span>' + routeEmptyMsg + '</span></div>';
        } else {
          html += renderSigmetCards(routeSigmets, 0);
        }
      }

      // FIR filter dropdown (always shown)
      html += '<div class="metbriefing-sigmet-filter">' +
        '<select class="metbriefing-sigmet-fir-select" data-sigmet-fir-select aria-label="Фильтр по FIR">' + firOptionsHtml + '</select></div>';

      // Non-route SIGMET display (below dropdown, when filter !== 'route')
      if (state.sigmetFirFilter !== 'route') {
        if (filteredSigmets.length === 0) {
          html += '<div class="metbriefing-sigmet-empty metbriefing-sigmet-empty--ok">' + icon('check-circle', 14) + '<span>SIGMET не обнаружены (' + firFilterLabel + ')</span></div>';
        } else {
          html += renderSigmetCards(filteredSigmets, 1000);
        }
      }
    }
    html += '</div>';

    // Inline NOTAM
    if (allAirports.length > 0) {
      html += '<div class="metbriefing-status-section metbriefing-status-section--full-bleed">' +
        '<div class="metbriefing-section-title">' + icon('alert-triangle', 18) + '<span>NOTAM \u043F\u043E \u043C\u0430\u0440\u0448\u0440\u0443\u0442\u0443</span></div>' +
        '<div class="metbriefing-inline-notam-list">';

      allAirports.forEach(function(icao) {
        var ntData = state.notamCache[icao];
        var ntLoading = state.notamLoading[icao];
        var ntError = state.notamErrors[icao];
        var isExpanded = !!state.expandedNotam[icao];
        var activeNotams = ntData && ntData.notams ? ntData.notams.filter(function(n) { return n.status === 'active'; }) : [];
        var highCount = activeNotams.filter(function(n) { return n.criticality === 'high'; }).length;
        var medCount = activeNotams.filter(function(n) { return n.criticality === 'medium'; }).length;
        var lowCount = activeNotams.filter(function(n) { return n.criticality === 'low'; }).length;

        html += '<div class="metbriefing-inline-notam ' + (isExpanded ? 'metbriefing-inline-notam--expanded' : '') + '">' +
          '<div class="metbriefing-inline-notam-header" data-notam-toggle="' + icao + '" role="button" tabindex="0" aria-expanded="' + isExpanded + '" aria-label="' + (isExpanded ? '\u0421\u0432\u0435\u0440\u043D\u0443\u0442\u044C' : '\u0420\u0430\u0437\u0432\u0435\u0440\u043D\u0443\u0442\u044C') + ' NOTAM ' + icao + '">' +
            '<div class="metbriefing-inline-notam-airport">' +
              icon(isExpanded ? 'chevron-down' : 'chevron-right', 14, 'metbriefing-inline-notam-chevron') +
              '<span class="metbriefing-inline-notam-icao">' + icao + '</span>' +
              (ntData && ntData.airportName ? '<span class="metbriefing-inline-notam-name">' + ntData.airportName + '</span>' : '') +
            '</div>' +
            '<div class="metbriefing-inline-notam-actions">' +
              (ntLoading ? icon('rotate-ccw', 14, 'metbriefing-spin') :
                ntData ?
                  (isStale(ntData.fetchedAt, NOTAM_STALE_MS) ? '<span class="metbriefing-stale-badge">' + icon('alert-triangle', 10) + '</span>' : '') +
                  (highCount > 0 ? '<span class="metbriefing-inline-notam-badge metbriefing-inline-notam-badge--high">' + highCount + ' \u0432\u044B\u0441.</span>' : '') +
                  (medCount > 0 ? '<span class="metbriefing-inline-notam-badge metbriefing-inline-notam-badge--medium">' + medCount + ' \u0441\u0440.</span>' : '') +
                  (lowCount > 0 ? '<span class="metbriefing-inline-notam-badge metbriefing-inline-notam-badge--low">' + lowCount + ' \u043D\u0438\u0437.</span>' : '')
                : '') +
            '</div>' +
          '</div>';

        if (ntLoading && !ntData) html += '<div class="metbriefing-inline-loading">' + icon('rotate-ccw', 18, 'metbriefing-spin') + '<span>\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 NOTAM...</span></div>';
        if (ntError && !ntData) html += '<div class="metbriefing-inline-error">' + icon('alert-triangle', 14) + '<span>' + ntError + '</span><button class="metbriefing-inline-retry" data-nt-retry="' + icao + '">\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C</button></div>';

        if (isExpanded && ntData) {
          html += '<div class="metbriefing-inline-notam-details">';
          if (ntData.message) html += '<div class="metbriefing-inline-notam-message">' + ntData.message + '</div>';
          if (activeNotams.length === 0) {
            html += '<div class="metbriefing-inline-notam-empty">\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 NOTAM</div>';
          } else {
            // Sort by criticality: high → medium → low
            var critOrder = { high: 0, medium: 1, low: 2 };
            var sortedNotams = activeNotams.slice().sort(function(a, b) {
              return (critOrder[a.criticality] !== undefined ? critOrder[a.criticality] : 9) - (critOrder[b.criticality] !== undefined ? critOrder[b.criticality] : 9);
            });
            sortedNotams.forEach(function(notam) {
              var qcodeBadge = notam.qcode ? '<span class="metbriefing-inline-notam-qcode">' + notam.qcode + '</span>' : '';
              html += '<div class="metbriefing-inline-notam-item metbriefing-inline-notam-item--' + notam.criticality + '" data-nt-goto-icao="' + icao + '" role="button" tabindex="0" aria-label="\u041F\u0435\u0440\u0435\u0439\u0442\u0438 \u043A NOTAM ' + icao + '">' +
                '<div class="metbriefing-inline-notam-item-header">' +
                  '<span class="metbriefing-inline-notam-item-id">' + notam.id + '</span>' +
                  qcodeBadge +
                  '<span class="metbriefing-inline-notam-crit metbriefing-inline-notam-crit--' + notam.criticality + '">' + getCriticalityLabel(notam.criticality) + '</span>' +
                '</div>' +
                (notam.subject ? '<div class="metbriefing-inline-notam-item-subject">' + notam.subject + '</div>' : '') +
              '</div>';
            });
          }
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</div></div>';
    }

    // Weather Maps — use cached blob URLs when available
    var mapsStale = getWxMaps().some(function(map) {
      var cached = state.wxMapCache[map.url];
      return !cached || !cached.blobUrl || isStale(cached.fetchedAt, WX_MAP_STALE_MS);
    });

    html += '<div class="metbriefing-status-section">' +
      '<div class="metbriefing-section-title">' + icon('map', 18) + '<span>\u041A\u0430\u0440\u0442\u044B \u043F\u043E\u0433\u043E\u0434\u044B</span>' +
      (state.wxMapLoading ? ' <span class="metbriefing-wx-maps-refreshing">' + icon('rotate-ccw', 14, 'metbriefing-spin') + '</span>' : '') +
      (mapsStale && !state.wxMapLoading ? ' <span class="metbriefing-stale-badge">' + icon('alert-triangle', 10) + '</span>' : '') +
      '</div>' +
      '<div class="metbriefing-wx-maps-grid">';
    getWxMaps().forEach(function(map, idx) {
      var cached = state.wxMapCache[map.url];
      var imgSrc = (cached && cached.blobUrl) ? cached.blobUrl : map.url;
      var isMapStale = !cached || !cached.blobUrl || isStale(cached.fetchedAt, WX_MAP_STALE_MS);
      html += '<div class="metbriefing-wx-map-thumb' + (map.full ? ' metbriefing-wx-map-thumb--full' : '') + '" data-wx-map-idx="' + idx + '">' +
        '<img src="' + imgSrc + '" data-full-src="' + (cached && cached.blobUrl ? cached.blobUrl : map.url) + '" data-wx-map-url="' + map.url + '" alt="' + map.label + '" loading="lazy" onerror="this.style.display=\'none\';" onload="this.style.display=\'\';">' +
        (state.wxMapLoading ? '<div class="metbriefing-wx-map-thumb-loading">' + icon('rotate-ccw', 24, 'metbriefing-spin') + '</div>' :
         isMapStale ? '<div class="metbriefing-wx-map-thumb-loading metbriefing-wx-map-thumb-loading--stale">' + icon('alert-triangle', 20) + '</div>' : '') +
        '<div class="metbriefing-wx-map-label">' + map.label + '</div>' +
      '</div>';
    });
    html += '</div></div>';

    // Task 28: Wind-by-flight-level maps (FL100-FL390, +6h, area C) — preload + dropdown
    var windCfg = getWindMaps();
    if (windCfg && windCfg.levels && windCfg.levels.length > 0) {
      var curLevel = state.windLevel || windCfg.defaultLevel || 340;
      var curCached = state.windMapCache[curLevel];
      var windImgSrc = (curCached && curCached.blobUrl) ? curCached.blobUrl : '';
      var windLoaded = state.windMapLoaded[curLevel];
      var preloadedCount = Object.keys(state.windMapCache).filter(function(k) {
        return state.windMapCache[k] && state.windMapCache[k].blobUrl;
      }).length;
      var totalLevels = windCfg.levels.length;
      html += '<div class="metbriefing-status-section metbriefing-wind-section">' +
        '<div class="metbriefing-section-title">' + icon('wind', 18) +
          '<span>\u0412\u0435\u0442\u0435\u0440 \u043F\u043E \u044D\u0448\u0435\u043B\u043E\u043D\u0430\u043C</span>' +
          '<span class="metbriefing-wind-area">\u0420\u0430\u0439\u043E\u043D: ' + escapeHtml(windCfg.areaLabel || windCfg.area || 'C') + ' \u00B7 +' + windCfg.hours + '\u0447</span>' +
          (state.windMapLoading ? ' <span class="metbriefing-wx-maps-refreshing">' + icon('rotate-ccw', 14, 'metbriefing-spin') + '</span>' : '') +
        '</div>' +
        '<div class="metbriefing-wind-controls">' +
          '<label class="metbriefing-wind-label" for="metbriefing-wind-level">\u042D\u0448\u0435\u043B\u043E\u043D:</label>' +
          '<select id="metbriefing-wind-level" class="metbriefing-wind-select" data-wind-level>' +
            windCfg.levels.map(function(lvl) {
              var sel = (lvl === curLevel) ? ' selected' : '';
              return '<option value="' + lvl + '"' + sel + '>FL' + lvl + '</option>';
            }).join('') +
          '</select>' +
          '<button class="metbriefing-wind-refresh-btn" data-wind-refresh aria-label="\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0432\u0441\u0435 \u0432\u0435\u0442\u0440\u043E\u0432\u044B\u0435 \u043A\u0430\u0440\u0442\u044B">' + icon('rotate-ccw', 16) + '</button>' +
          '<span class="metbriefing-wind-progress">\u041A\u044D\u0448: ' + preloadedCount + '/' + totalLevels + '</span>' +
        '</div>' +
        '<div class="metbriefing-wind-map-container">' +
          (state.windMapLoading && !windImgSrc ? '<div class="metbriefing-wx-map-thumb-loading">' + icon('rotate-ccw', 24, 'metbriefing-spin') + '</div>' : '') +
          (windImgSrc ?
            '<img class="metbriefing-wind-map-img" src="' + windImgSrc + '" data-full-src="' + windImgSrc + '" alt="\u0412\u0435\u0442\u0435\u0440 FL' + curLevel + ' +' + windCfg.hours + '\u0447 (' + escapeHtml(windCfg.areaLabel || windCfg.area) + ')" onerror="this.style.display=\'none\';" onload="this.style.display=\'\';">' :
            (!state.windMapLoading ? '<div class="metbriefing-wind-map-placeholder">\u041A\u0430\u0440\u0442\u0430 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u0430. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u2197 \u0434\u043B\u044F \u043F\u0440\u0435\u0434\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438.</div>' : '')) +
        '</div>' +
      '</div>';
    }

    // Summary
    var dataWarnings = getDataStatusWarnings();
    html += '<div class="metbriefing-summary">' +
      '<div class="metbriefing-readiness-indicator metbriefing-readiness-indicator--' + readiness.level + '">' +
        '<span class="metbriefing-readiness-dot"></span>' +
        '<span class="metbriefing-readiness-label">' + readiness.label + '</span>' +
        '<button class="metbriefing-readiness-refresh-btn" data-mb-refresh-all aria-label="\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0432\u0441\u0435">' + icon('rotate-ccw', 18) + '</button>' +
      '</div>';
    if (readiness.issues.length > 0) {
      html += '<ul class="metbriefing-readiness-issues">';
      readiness.issues.forEach(function(issue) { html += '<li>' + issue + '</li>'; });
      html += '</ul>';
    }
    // Data status warnings
    if (dataWarnings.length > 0) {
      html += '<div class="metbriefing-readiness-warnings">';
      html += '<div class="metbriefing-readiness-warnings-title">' + icon('info', 14) + '<span>\u0421\u0442\u0430\u0442\u0443\u0441 \u0434\u0430\u043D\u043D\u044B\u0445</span></div>';
      dataWarnings.forEach(function(w) {
        var wClass = 'metbriefing-readiness-warning--' + w.type;
        var wIcon = w.type === 'loading' ? icon(w.icon, 14, 'metbriefing-spin') : icon(w.icon, 14);
        var actionHtml = '';
        if (w.action) {
          actionHtml = '<button class="metbriefing-readiness-warning-action" data-mb-warn-action="' + w.action + '">' + icon('rotate-ccw', 12) + '\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C</button>';
        }
        html += '<div class="metbriefing-readiness-warning ' + wClass + '">' +
          '<span class="metbriefing-readiness-warning-icon">' + wIcon + '</span>' +
          '<span class="metbriefing-readiness-warning-label">' + w.label + '</span>' +
          '<span class="metbriefing-readiness-warning-detail">' + w.detail + '</span>' +
          actionHtml +
        '</div>';
      });
      html += '</div>';
    }
    html += '<button class="metbriefing-share-btn" id="metbriefing-share-btn">' + icon('share', 16) + '\u041F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F \u0431\u0440\u0438\u0444\u0438\u043D\u0433\u043E\u043C</button></div>';

    el.innerHTML = html;
    bindBriefingEvents(el);
  }

  function bindBriefingEvents(el) {
    // Weather card click → go to weather tab with scroll+highlight to specific airport
    el.querySelectorAll('[data-wx-goto-tab]').forEach(function(card) {
      card.addEventListener('click', function(e) {
        // Don't navigate if refresh/retry button clicked
        if (e.target.closest('[data-wx-refresh]') || e.target.closest('[data-wx-retry]')) return;
        var gotoIcao = card.getAttribute('data-wx-goto-icao');
        state.activeTab = 'weather';
        state.wxScrollToIcao = gotoIcao || null;
        // Only fetch if data is missing
        var wxAirports = getAllRouteAirports().concat(state.extraAirports.filter(function(a) { return getAllRouteAirports().indexOf(a) === -1; }));
        var needMetar = wxAirports.filter(function(icao) { return !state.weatherCache[icao] || !state.weatherCache[icao].metar; });
        var needTaf = wxAirports.filter(function(icao) { return !state.weatherCache[icao] || !state.weatherCache[icao].taf; });
        if (needMetar.length > 0) fetchMetarBatch(needMetar);
        if (needTaf.length > 0) fetchTafBatch(needTaf);
        renderTabSwitcher();
        renderCurrentTab();
      });
      card.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          var gotoIcao2 = card.getAttribute('data-wx-goto-icao');
          state.activeTab = 'weather';
          state.wxScrollToIcao = gotoIcao2 || null;
          // Only fetch if data is missing
          var wxAirports2 = getAllRouteAirports().concat(state.extraAirports.filter(function(a) { return getAllRouteAirports().indexOf(a) === -1; }));
          var needMetar2 = wxAirports2.filter(function(icao) { return !state.weatherCache[icao] || !state.weatherCache[icao].metar; });
          var needTaf2 = wxAirports2.filter(function(icao) { return !state.weatherCache[icao] || !state.weatherCache[icao].taf; });
          if (needMetar2.length > 0) fetchMetarBatch(needMetar2);
          if (needTaf2.length > 0) fetchTafBatch(needTaf2);
          renderTabSwitcher();
          renderCurrentTab();
        }
      });
    });
    // NOTAM toggles handled via delegated listener on container — no direct binding needed
    // Weather refresh/retry — per-airport AVWX METAR+TAF
    el.querySelectorAll('[data-wx-refresh]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        refreshAirportWeather(btn.getAttribute('data-wx-refresh'));
      });
    });
    el.querySelectorAll('[data-wx-retry]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        refreshAirportWeather(btn.getAttribute('data-wx-retry'));
      });
    });
    // NOTAM retry
    el.querySelectorAll('[data-nt-retry]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        fetchNotam(btn.getAttribute('data-nt-retry'));
      });
    });
    // NOTAM item click → go to NOTAM tab with scroll+highlight+auto-expand to specific airport
    el.querySelectorAll('[data-nt-goto-icao]').forEach(function(item) {
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        var gotoIcao = item.getAttribute('data-nt-goto-icao');
        state.activeTab = 'notam';
        state.notamScrollToIcao = gotoIcao;
        state.expandedNotamTab[gotoIcao] = true;
        renderTabSwitcher();
        renderCurrentTab();
      });
      item.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          var gotoIcao2 = item.getAttribute('data-nt-goto-icao');
          state.activeTab = 'notam';
          state.notamScrollToIcao = gotoIcao2;
          state.expandedNotamTab[gotoIcao2] = true;
          renderTabSwitcher();
          renderCurrentTab();
        }
      });
    });
    // Data status warning actions
    el.querySelectorAll('[data-mb-warn-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var action = btn.getAttribute('data-mb-warn-action');
        if (action === 'maps-refresh') {
          fetchAllWxMaps(true);
        } else if (action.indexOf('wx-refresh-') === 0 || action.indexOf('wx-retry-') === 0 || action.indexOf('wx-fetch-') === 0) {
          var wxIcao = action.replace('wx-refresh-', '').replace('wx-retry-', '').replace('wx-fetch-', '');
          refreshAirportWeather(wxIcao);
        } else if (action.indexOf('nt-retry-') === 0 || action.indexOf('nt-refresh-') === 0 || action.indexOf('nt-fetch-') === 0) {
          var ntIcao = action.replace('nt-retry-', '').replace('nt-refresh-', '').replace('nt-fetch-', '');
          fetchNotam(ntIcao);
        } else if (action === 'sigmet-retry' || action === 'sigmet-refresh' || action === 'sigmet-fetch') {
          fetchSigmetData(true);
        }
      });
    });
    // Task 28: Wind-by-flight-level maps — dropdown level change + refresh button
    var windLevelSelect = el.querySelector('[data-wind-level]');
    if (windLevelSelect) {
      windLevelSelect.addEventListener('change', function() {
        var newLevel = parseInt(windLevelSelect.value, 10);
        if (!isNaN(newLevel)) {
          state.windLevel = newLevel;
          renderCurrentTab();
          // If this level not yet cached, fetch it on demand
          if (!state.windMapCache[newLevel] || !state.windMapCache[newLevel].blobUrl) {
            fetchAndCacheWindMap(newLevel, false).then(function() { renderCurrentTab(); });
          }
        }
      });
    }
    var windRefreshBtn = el.querySelector('[data-wind-refresh]');
    if (windRefreshBtn) {
      windRefreshBtn.addEventListener('click', function() {
        preloadAllWindMaps(true);
      });
    }
    // Wind map image → open PhotoSwipe
    var windImg = el.querySelector('.metbriefing-wind-map-img');
    if (windImg) {
      windImg.addEventListener('click', function() {
        if (window.app && window.app.openPhotoSwipe) {
          window.app.openPhotoSwipe(windImg, el);
        }
      });
      windImg.style.cursor = 'zoom-in';
    }
    // Weather Maps — hide loading spinner when image loads, open PhotoSwipe on click
    el.querySelectorAll('.metbriefing-wx-map-thumb').forEach(function(thumb) {
      var img = thumb.querySelector('img');
      var spinner = thumb.querySelector('.metbriefing-wx-map-thumb-loading');
      if (img) {
        if (img.complete && img.naturalWidth > 0) {
          if (spinner) spinner.style.display = 'none';
        } else {
          img.addEventListener('load', function() {
            if (spinner) spinner.style.display = 'none';
          });
          img.addEventListener('error', function() {
            if (spinner) spinner.innerHTML = '<span style="font-size:var(--font-xs);color:var(--color-text-muted)">\u041D\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E</span>';
          });
        }
      }
      thumb.addEventListener('click', function() {
        if (app && app.openPhotoSwipe) {
          var mapImg = thumb.querySelector('img');
          app.openPhotoSwipe(mapImg || thumb, el);
        }
      });
    });
  }

  // ===== Render: Weather Tab =====
  function renderWeatherTab(el) {
    var routeAirports = getAllRouteAirports();
    var displayAirports = routeAirports.concat(state.extraAirports.filter(function(a) { return routeAirports.indexOf(a) === -1; }));

    var html = '';

    // Search
    html += '<div class="metbriefing-wx-search-bar">' +
      '<div class="metbriefing-wx-search-input-wrap">' +
        icon('search', 18, 'metbriefing-wx-search-icon') +
        '<input type="text" class="metbriefing-wx-search-input" id="wxSearchInput" placeholder="ICAO \u043A\u043E\u0434 (\u043D\u0430\u043F\u0440. UUEE)" value="' + state.wxSearchInput + '" maxlength="4" aria-label="\u041F\u043E\u0438\u0441\u043A \u043F\u043E ICAO \u043A\u043E\u0434\u0443">' +
        (state.wxSearchInput ? '<button class="metbriefing-wx-search-clear" id="wxSearchClear" aria-label="\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C">' + icon('x', 16) + '</button>' : '') +
      '</div>' +
      '<button class="metbriefing-wx-search-btn" id="wxSearchBtn"' + (state.wxSearchInput.length !== 4 ? ' disabled' : '') + ' aria-label="\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0430\u044D\u0440\u043E\u043F\u043E\u0440\u0442">' + icon('plus', 18) + '</button>' +
    '</div>';

    // Weather cards or empty
    if (displayAirports.length === 0) {
      html += '<div class="metbriefing-wx-empty">' + icon('cloud', 56, 'metbriefing-wx-empty-icon') +
        '<div class="metbriefing-wx-empty-text">\u041D\u0435\u0442 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0445 \u0430\u044D\u0440\u043E\u043F\u043E\u0440\u0442\u043E\u0432</div>' +
        '<div class="metbriefing-wx-empty-sub">\u0412\u0432\u0435\u0434\u0438\u0442\u0435 ICAO \u043A\u043E\u0434 \u0438\u043B\u0438 \u0443\u043A\u0430\u0436\u0438\u0442\u0435 \u043C\u0430\u0440\u0448\u0440\u0443\u0442 \u0432\u044B\u0448\u0435</div></div>';
    } else {
      html += '<div class="metbriefing-wx-cards">';
      displayAirports.forEach(function(icao) {
        var data = state.weatherCache[icao];
        var isLoading = state.wxLoading[icao];
        var error = state.wxErrors[icao];
        var isNight = isNightAtAirport(icao);

        // Build station inline line for header
        var wxStationLine = '';
        if (data && data.station) {
          var wxSt = data.station;
          var wxStParts = [];
          if (wxSt.city) wxStParts.push(escapeHtml(wxSt.city + (wxSt.country && wxSt.country.name ? ', ' + wxSt.country.name : (wxSt.country && typeof wxSt.country === 'string' ? ', ' + wxSt.country : ''))));
          if (wxSt.elevation) {
            var elevFt = (typeof wxSt.elevation === 'object' && wxSt.elevation.feet) ? wxSt.elevation.feet : (typeof wxSt.elevation === 'number' ? wxSt.elevation : null);
            if (elevFt !== null) wxStParts.push(Math.round(elevFt) + ' ft');
          }
          // Timezone UTC offset
          if (wxSt.utcOffset !== null && wxSt.utcOffset !== undefined) {
            var offset = wxSt.utcOffset;
            var offsetStr = 'UTC' + (offset >= 0 ? '+' : '') + (offset % 1 === 0 ? offset : offset.toFixed(1));
            if (wxSt.dstActive) offsetStr += ' DST';
            wxStParts.push(offsetStr);
          }
          if (wxSt.runways && wxSt.runways.length > 0) wxStParts.push(wxSt.runways.map(function(r){ return r.ident1 + '/' + r.ident2; }).join(', '));
          wxStationLine = wxStParts.length > 0 ? '<span class="metbriefing-wx-card-station">' + wxStParts.join(' \u00B7 ') + '</span>' : '';
        }

        var wxFlightRules = (data && data.flight_rules) || null;
        html += '<div class="metbriefing-wx-card ' + getWxCardBorderClass(wxFlightRules, isNight) + '" data-wx-card-icao="' + icao + '">';
        // Header
        html += '<div class="metbriefing-wx-card-header">' +
          '<div class="metbriefing-wx-card-airport">' +
            '<span class="metbriefing-wx-card-icao">' + icao + '</span>' +
            (data && data.airportName ? '<span class="metbriefing-wx-card-name">' + escapeHtml(data.airportName) + '</span>' : '') +
            wxStationLine +
          '</div>' +
          '<div class="metbriefing-wx-card-actions">' +
            '<span class="metbriefing-wx-card-daynight">' + icon(isNight ? 'moon' : 'sun', 16) + '</span>' +
            '<button class="metbriefing-wx-card-action" data-wx-card-refresh="' + icao + '" aria-label="\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"' + (isLoading ? ' disabled' : '') + '>' +
              icon('rotate-ccw', 16, isLoading ? 'metbriefing-spin' : '') +
            '</button>' +
            (routeAirports.indexOf(icao) === -1 ?
              '<button class="metbriefing-wx-card-action metbriefing-wx-card-action--danger" data-wx-card-remove="' + icao + '" aria-label="\u0423\u0434\u0430\u043B\u0438\u0442\u044C">' + icon('trash', 16) + '</button>' : '') +
          '</div>' +
        '</div>';

        if (isLoading && !data) {
          html += '<div class="metbriefing-wx-card-loading">' + icon('rotate-ccw', 24, 'metbriefing-spin') + '<span>\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043F\u043E\u0433\u043E\u0434\u044B...</span></div>';
        }
        if (error && !data) {
          html += '<div class="metbriefing-wx-card-error">' + icon('alert-triangle', 18) + '<span>' + error + '</span>' +
            '<button class="metbriefing-wx-retry-btn" data-wx-card-retry="' + icao + '">\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C</button></div>';
        }

        if (data) {
          // METAR (always expanded)
          if (data.metar) {
            html += '<div class="metbriefing-wx-metar-raw"><span class="metbriefing-wx-metar-label">METAR</span><code class="metbriefing-wx-metar-code">' + escapeHtml(data.metar) + '</code></div>';
          }

          // TAF (always expanded)
          if (data.taf) {
            html += '<div class="metbriefing-wx-taf-raw"><span class="metbriefing-wx-taf-label">TAF</span><code class="metbriefing-wx-taf-code">' + escapeHtml(data.taf) + '</code></div>';
          }

          // METAR History — fetched on demand from AWC proxy (last 2 hours)
          if (data.metar && AWC_PROXY_URL) {
            var metarHist = state.metarHistory[icao];
            var histLoading = state.metarHistoryLoading[icao];
            if (histLoading) {
              html += '<div class="metbriefing-wx-metar-history-hint">' + icon('rotate-ccw', 12, 'metbriefing-spin') + '<span>\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u0438\u0441\u0442\u043E\u0440\u0438\u0438...</span></div>';
            } else if (metarHist && metarHist.length > 0) {
              html += '<div class="metbriefing-wx-metar-history">';
              html += '<div class="metbriefing-wx-metar-history-title">' + icon('clock', 14) + '<span>\u0418\u0441\u0442\u043E\u0440\u0438\u044F METAR (2 \u0447)</span></div>';
              metarHist.forEach(function(h) {
                var timeLabel = h.observedAt ? formatTime(h.observedAt) : '';
                var catClass = h.flightCat ? ' metbriefing-condition--' + h.flightCat.toLowerCase() : '';
                html += '<div class="metbriefing-wx-metar-history-item' + catClass + '">';
                html += '<span class="metbriefing-wx-metar-history-label">' + timeLabel + (h.flightCat ? ' <span class="metbriefing-wx-hist-cat">' + h.flightCat + '</span>' : '') + '</span>';
                html += '<code class="metbriefing-wx-metar-history-code">' + escapeHtml(h.raw) + '</code>';
                html += '</div>';
              });
              html += '</div>';
            } else {
              // Show button to load history
              html += '<button class="metbriefing-wx-metar-history-btn" data-hist-icao="' + icao + '">' + icon('clock', 14) + '<span>\u0418\u0441\u0442\u043E\u0440\u0438\u044F METAR (2 \u0447)</span></button>';
            }
          }

          // Footer
          var staleWarning = isStale(data.cachedAt)
            ? '<span class="metbriefing-wx-stale-badge">' + icon('alert-triangle', 12) + 'Данные устарели</span>'
            : '';
          html += '<div class="metbriefing-wx-card-footer">' +
            '<span class="metbriefing-wx-obs-time">\u041D\u0430\u0431\u043B\u044E\u0434\u0435\u043D\u0438\u0435: ' + formatTime(data.observedAt) + '</span>' +
            (data.cachedAt ? '<span class="metbriefing-wx-cache-time" style="margin-left:auto">\u041A\u044D\u0448: ' + formatRelativeTime(new Date(data.cachedAt).toISOString()) + '</span>' : '') +
            staleWarning +
          '</div>';
        }

        html += '</div>';
      });
      html += '</div>';
    }

    el.innerHTML = html;
    bindWeatherEvents(el);

    // Scroll + highlight to specific airport (from Briefing tab click)
    if (state.wxScrollToIcao) {
      var wxTarget = el.querySelector('[data-wx-card-icao="' + state.wxScrollToIcao + '"]');
      if (wxTarget) {
        wxTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
        wxTarget.classList.add('metbriefing-wx-card--highlight');
        setTimeout(function() { wxTarget.classList.remove('metbriefing-wx-card--highlight'); }, 2000);
      }
      state.wxScrollToIcao = null;
    }
  }

  function bindWeatherEvents(el) {
    var searchInput = document.getElementById('wxSearchInput');
    var searchBtn = document.getElementById('wxSearchBtn');
    var searchClear = document.getElementById('wxSearchClear');

    if (searchInput) {
      searchInput.addEventListener('input', function(e) {
        state.wxSearchInput = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
        e.target.value = state.wxSearchInput;
        var searchBtnEl = document.getElementById('wxSearchBtn');
        if (searchBtnEl) searchBtnEl.disabled = state.wxSearchInput.length !== 4;
        var wrap = searchInput.closest('.metbriefing-wx-search-input-wrap');
        if (wrap) {
          var existingClear = wrap.querySelector('.metbriefing-wx-search-clear');
          if (state.wxSearchInput && !existingClear) {
            var btn = document.createElement('button');
            btn.className = 'metbriefing-wx-search-clear';
            btn.id = 'wxSearchClear';
            btn.setAttribute('aria-label', '\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C');
            btn.innerHTML = icon('x', 16);
            btn.addEventListener('click', function() { state.wxSearchInput = ''; renderCurrentTab(); });
            wrap.insertBefore(btn, searchInput.nextSibling);
          } else if (!state.wxSearchInput && existingClear) {
            existingClear.remove();
          }
        }
      });
      searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') addWxAirport();
      });
    }
    if (searchBtn) searchBtn.addEventListener('click', addWxAirport);
    if (searchClear) searchClear.addEventListener('click', function() { state.wxSearchInput = ''; renderCurrentTab(); });

    el.querySelectorAll('[data-wx-card-refresh]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        refreshAirportWeather(btn.getAttribute('data-wx-card-refresh'));
      });
    });
    el.querySelectorAll('[data-wx-card-retry]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        refreshAirportWeather(btn.getAttribute('data-wx-card-retry'));
      });
    });

    // METAR history buttons
    el.querySelectorAll('[data-hist-icao]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        fetchMetarHistory(btn.getAttribute('data-hist-icao'));
      });
    });
    el.querySelectorAll('[data-wx-card-remove]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var icao = btn.getAttribute('data-wx-card-remove');
        state.extraAirports = state.extraAirports.filter(function(a) { return a !== icao; });
        delete state.weatherCache[icao]; delete state.wxErrors[icao]; delete state.wxLoading[icao];
        saveWxCache();
        renderCurrentTab();
      });
    });
    // TAF toggles handled via delegated listener on container — no direct binding needed
  }

  function addWxAirport() {
    if (state.wxSearchInput.trim()) {
      addWxAirportByCode(state.wxSearchInput);
      state.wxSearchInput = '';
      renderCurrentTab();
    }
  }

  function addWxAirportByCode(code) {
    var c = code.toUpperCase().trim();
    if (c.length !== 4 || !/^[A-Z]{4}$/.test(c)) return;
    var routeAirports = getAllRouteAirports();
    if (routeAirports.indexOf(c) !== -1) return;
    if (state.extraAirports.indexOf(c) === -1) {
      state.extraAirports.push(c);
    }
    // Fetch station + METAR + TAF for the new airport
    fetchAvwxStation([c]);
    fetchMetarBatch([c]);
    fetchTafBatch([c]);
  }

  // ===== Render: NOTAM Tab =====
  function renderNotamTab(el) {
    // Merge route airports + manual
    var routeAirports = getAllRouteAirports();
    var manualOnly = state.notamAirports.filter(function(a) { return state.manualNotamAirports[a]; });
    var airports = routeAirports.slice();
    manualOnly.forEach(function(a) { if (airports.indexOf(a) === -1) airports.push(a); });
    state.notamAirports = airports;

    // Fetch NOTAM for airports missing data (belt-and-suspenders)
    airports.forEach(function(icao) {
      if (!state.notamCache[icao] && !state.notamLoading[icao] && !state.notamErrors[icao]) {
        fetchNotam(icao);
      }
    });

    var html = '';

    // Search
    html += '<div class="metbriefing-notam-search-bar">' +
      '<div class="metbriefing-notam-search-input-wrap">' +
        icon('search', 18, 'metbriefing-notam-search-icon') +
        '<input type="text" class="metbriefing-notam-search-input" id="notamSearchInput" placeholder="ICAO \u043A\u043E\u0434 (\u043D\u0430\u043F\u0440. UUEE)" value="' + state.notamSearchInput + '" maxlength="4" aria-label="\u041F\u043E\u0438\u0441\u043A NOTAM \u043F\u043E ICAO \u043A\u043E\u0434\u0443">' +
        (state.notamSearchInput ? '<button class="metbriefing-notam-search-clear" id="notamSearchClear" aria-label="\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C">' + icon('x', 16) + '</button>' : '') +
      '</div>' +
      '<button class="metbriefing-notam-search-btn" id="notamSearchBtn"' + (state.notamSearchInput.length !== 4 ? ' disabled' : '') + ' aria-label="\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0430\u044D\u0440\u043E\u043F\u043E\u0440\u0442">' + icon('plus', 18) + '</button>' +
    '</div>';

    // Collect all notams grouped by airport
    var allNotams = [];
    var notamsByAirport = {};
    airports.forEach(function(icao) {
      var d = state.notamCache[icao];
      if (d && d.notams) {
        var filteredForAirport = d.notams.slice();
        if (state.filterTab === 'active') filteredForAirport = filteredForAirport.filter(function(n) { return n.status === 'active'; });
        if (state.filterTab === 'expired') filteredForAirport = filteredForAirport.filter(function(n) { return n.status === 'expired'; });
        if (state.textFilter.trim()) {
          var q = state.textFilter.toLowerCase();
          filteredForAirport = filteredForAirport.filter(function(n) {
            return (n.subject && n.subject.toLowerCase().indexOf(q) !== -1) ||
                   (n.description && n.description.toLowerCase().indexOf(q) !== -1) ||
                   (n.id && n.id.toLowerCase().indexOf(q) !== -1);
          });
        }
        notamsByAirport[icao] = filteredForAirport;
        filteredForAirport.forEach(function(n) {
          var copy = {};
          var nkeys = Object.keys(n);
          for (var i = 0; i < nkeys.length; i++) { copy[nkeys[i]] = n[nkeys[i]]; }
          copy.airportName = d.airportName;
          allNotams.push(copy);
        });
      }
    });

    var totalActive = allNotams.filter(function(n) { return n.status === 'active'; }).length;
    var totalExpired = allNotams.filter(function(n) { return n.status === 'expired'; }).length;
    var totalAll = allNotams.length;

    // Filter tabs
    if (airports.length > 0) {
      html += '<div class="metbriefing-nt-filter-tabs">' +
        '<button class="metbriefing-nt-filter-pill ' + (state.filterTab === 'all' ? 'metbriefing-nt-filter-pill--active' : '') + '" data-nt-filter="all">\u0412\u0441\u0435 <span class="metbriefing-nt-filter-count">' + totalAll + '</span></button>' +
        '<button class="metbriefing-nt-filter-pill ' + (state.filterTab === 'active' ? 'metbriefing-nt-filter-pill--active' : '') + '" data-nt-filter="active">\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0435 <span class="metbriefing-nt-filter-count">' + totalActive + '</span></button>' +
        '<button class="metbriefing-nt-filter-pill ' + (state.filterTab === 'expired' ? 'metbriefing-nt-filter-pill--active' : '') + '" data-nt-filter="expired">\u0418\u0441\u0442\u0451\u043A\u0448\u0438\u0435 <span class="metbriefing-nt-filter-count">' + totalExpired + '</span></button>' +
      '</div>';
    }

    // Airport chips bar + refresh-all удалены как дублирующие —
    // код/кол-во/удаление уже есть в accordion-заголовках ниже,
    // обновление — через кнопку «Брифинг готов».
    // Text filter
    if (airports.length > 0) {
      html += '<div class="metbriefing-notam-filters"><div class="metbriefing-notam-text-filter">' +
        icon('search', 14) +
        '<input type="text" class="metbriefing-notam-text-input" id="notamTextFilter" placeholder="\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u0442\u0435\u043A\u0441\u0442\u0443..." value="' + state.textFilter + '" aria-label="\u0424\u0438\u043B\u044C\u0442\u0440 \u043F\u043E \u0442\u0435\u043A\u0441\u0442\u0443">' +
        (state.textFilter ? '<button class="metbriefing-notam-text-clear" id="notamTextClear" aria-label="\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C">' + icon('x', 14) + '</button>' : '') +
      '</div></div>';
    }

    // Empty state or grouped by airport
    if (airports.length === 0) {
      html += '<div class="metbriefing-notam-empty">' + icon('alert-triangle', 56, 'metbriefing-notam-empty-icon') +
        '<div class="metbriefing-notam-empty-text">\u041D\u0435\u0442 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0445 \u0430\u044D\u0440\u043E\u043F\u043E\u0440\u0442\u043E\u0432</div>' +
        '<div class="metbriefing-notam-empty-sub">\u0412\u0432\u0435\u0434\u0438\u0442\u0435 ICAO \u043A\u043E\u0434 \u0438\u043B\u0438 \u0443\u043A\u0430\u0436\u0438\u0442\u0435 \u043C\u0430\u0440\u0448\u0440\u0443\u0442 \u0432\u044B\u0448\u0435</div></div>';
    } else if (totalAll === 0) {
      html += '<div class="metbriefing-notam-no-results">' + icon('search', 32, 'metbriefing-notam-no-results-icon') +
        '<div class="metbriefing-notam-no-results-text">NOTAM \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B</div></div>';
    } else {
      // Group by airport with accordion sections
      airports.forEach(function(icao) {
        var d = state.notamCache[icao];
        var isLoading = state.notamLoading[icao];
        var ntError = state.notamErrors[icao];
        var airportNotams = notamsByAirport[icao] || [];
        var allAirportNotams = d && d.notams ? d.notams : [];
        var highCount = allAirportNotams.filter(function(n) { return n.status === 'active' && n.criticality === 'high'; }).length;
        var medCount = allAirportNotams.filter(function(n) { return n.status === 'active' && n.criticality === 'medium'; }).length;
        var lowCount = allAirportNotams.filter(function(n) { return n.status === 'active' && n.criticality === 'low'; }).length;
        var activeCount = allAirportNotams.filter(function(n) { return n.status === 'active'; }).length;
        var isExpanded = !!state.expandedNotamTab[icao];

        html += '<div class="metbriefing-notam-group' + (isExpanded ? ' metbriefing-notam-group--expanded' : '') + '" data-nt-group-icao="' + icao + '">' +
          '<div class="metbriefing-notam-group-header" data-nt-group-toggle="' + icao + '" role="button" tabindex="0" aria-expanded="' + isExpanded + '">' +
            '<div class="metbriefing-notam-group-airport">' +
              icon(isExpanded ? 'chevron-down' : 'chevron-right', 16, 'metbriefing-notam-group-chevron') +
              '<span class="metbriefing-notam-group-icao">' + icao + '</span>' +
              (d && d.airportName ? '<span class="metbriefing-notam-group-name">' + d.airportName + '</span>' : '') +
            '</div>' +
            '<div class="metbriefing-notam-group-badges">' +
              (isLoading ? icon('rotate-ccw', 14, 'metbriefing-spin') :
                (highCount > 0 ? '<span class="metbriefing-inline-notam-badge metbriefing-inline-notam-badge--high">' + highCount + ' \u0432\u044B\u0441.</span>' : '') +
                (medCount > 0 ? '<span class="metbriefing-inline-notam-badge metbriefing-inline-notam-badge--medium">' + medCount + ' \u0441\u0440.</span>' : '') +
                (lowCount > 0 ? '<span class="metbriefing-inline-notam-badge metbriefing-inline-notam-badge--low">' + lowCount + ' \u043D\u0438\u0437.</span>' : '') +
                (activeCount === 0 && !isLoading ? '<span class="metbriefing-notam-group-count-zero">0</span>' : '')
              ) +
              '<button class="metbriefing-notam-airport-chip-remove" data-nt-remove="' + icao + '" aria-label="\u0423\u0434\u0430\u043B\u0438\u0442\u044C ' + icao + '">' + icon('x', 14) + '</button>' +
            '</div>' +
          '</div>';

        if (isLoading && !d) {
          html += '<div class="metbriefing-inline-loading">' + icon('rotate-ccw', 18, 'metbriefing-spin') + '<span>\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 NOTAM...</span></div>';
        }
        if (ntError && !d) {
          html += '<div class="metbriefing-inline-error">' + icon('alert-triangle', 14) + '<span>' + ntError + '</span></div>';
        }

        if (isExpanded) {
          html += '<div class="metbriefing-notam-group-cards">';
          if (airportNotams.length === 0) {
            html += '<div class="metbriefing-notam-no-results metbriefing-notam-no-results--inner">' +
              '<div class="metbriefing-notam-no-results-text">Нет NOTAM</div></div>';
          } else {
            // Sort by criticality: high → medium → low
            var critOrderTab = { high: 0, medium: 1, low: 2 };
            var sortedAirportNotams = airportNotams.slice().sort(function(a, b) {
              return (critOrderTab[a.criticality] !== undefined ? critOrderTab[a.criticality] : 9) - (critOrderTab[b.criticality] !== undefined ? critOrderTab[b.criticality] : 9);
            });
            sortedAirportNotams.forEach(function(notam) {
              html += '<div class="metbriefing-notam-card metbriefing-notam-card--' + notam.criticality + ' metbriefing-notam-card--' + notam.status + '">' +
                '<div class="metbriefing-notam-card-header">' +
                  '<div class="metbriefing-notam-card-id">' +
                    '<span class="metbriefing-notam-card-identifier">' + escapeHtml(notam.id) + '</span>' +
                    (notam.qcode ? '<span class="metbriefing-notam-qcode-badge">' + escapeHtml(notam.qcode) + '</span>' : '') +
                    '<span class="metbriefing-notam-type-badge metbriefing-notam-type-badge--' + notam.type + '">' + escapeHtml(notam.type) + '</span>' +
                    '<span class="metbriefing-notam-criticality-badge metbriefing-notam-criticality-badge--' + notam.criticality + '">' + escapeHtml(getCriticalityLabel(notam.criticality)) + '</span>' +
                  '</div>' +
                  '<div class="metbriefing-notam-card-meta">' +
                    '<span class="metbriefing-notam-status-badge metbriefing-notam-status-badge--' + notam.status + '">' + (notam.status === 'active' ? '\u0410\u043A\u0442\u0438\u0432\u0435\u043D' : '\u0418\u0441\u0442\u0451\u043A') + '</span>' +
                  '</div>' +
                '</div>' +
                '<div class="metbriefing-notam-card-subject">' + escapeHtml(notam.subject) + '</div>' +
                '<div class="metbriefing-notam-card-description">' + notam.description.split('\n').map(function(l) { return '<p>' + escapeHtml(l) + '</p>'; }).join('') + '</div>' +
                '<div class="metbriefing-notam-card-dates">' +
                  '<div class="metbriefing-notam-date-item">' + icon('clock', 14) + '<span class="metbriefing-notam-date-label">\u0421:</span><span class="metbriefing-notam-date-value">' + formatNotamDate(notam.effectiveFrom) + '</span></div>' +
                  '<div class="metbriefing-notam-date-item">' + icon('clock', 14) + '<span class="metbriefing-notam-date-label">\u041F\u043E:</span><span class="metbriefing-notam-date-value">' + formatNotamDate(notam.effectiveTo) + '</span></div>' +
                '</div>' +
              '</div>';
            });
          }
          html += '</div>';
        }
        html += '</div>';
      });
    }

    el.innerHTML = html;
    bindNotamEvents(el);

    // Scroll + highlight to specific airport (from Briefing tab click)
    if (state.notamScrollToIcao) {
      var ntTarget = el.querySelector('[data-nt-group-icao="' + state.notamScrollToIcao + '"]');
      if (ntTarget) {
        ntTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
        ntTarget.classList.add('metbriefing-notam-group--highlight');
        setTimeout(function() { ntTarget.classList.remove('metbriefing-notam-group--highlight'); }, 2000);
      }
      state.notamScrollToIcao = null;
    }
  }

  function bindNotamEvents(el) {
    var searchInput = document.getElementById('notamSearchInput');
    var searchBtn = document.getElementById('notamSearchBtn');
    var searchClear = document.getElementById('notamSearchClear');
    var textFilter = document.getElementById('notamTextFilter');
    var textClear = document.getElementById('notamTextClear');
    // notamRefreshAll удалён — обновление через «Брифинг готов»

    if (searchInput) {
      searchInput.addEventListener('input', function(e) {
        state.notamSearchInput = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
        e.target.value = state.notamSearchInput;
        var searchBtnEl = document.getElementById('notamSearchBtn');
        if (searchBtnEl) searchBtnEl.disabled = state.notamSearchInput.length !== 4;
        var wrap = searchInput.closest('.metbriefing-notam-search-input-wrap');
        if (wrap) {
          var existingClear = wrap.querySelector('.metbriefing-notam-search-clear');
          if (state.notamSearchInput && !existingClear) {
            var btn = document.createElement('button');
            btn.className = 'metbriefing-notam-search-clear';
            btn.id = 'notamSearchClear';
            btn.setAttribute('aria-label', '\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C');
            btn.innerHTML = icon('x', 16);
            btn.addEventListener('click', function() { state.notamSearchInput = ''; renderCurrentTab(); });
            wrap.insertBefore(btn, searchInput.nextSibling);
          } else if (!state.notamSearchInput && existingClear) {
            existingClear.remove();
          }
        }
      });
      searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') addNotamAirport();
      });
    }
    if (searchBtn) searchBtn.addEventListener('click', addNotamAirport);
    if (searchClear) searchClear.addEventListener('click', function() { state.notamSearchInput = ''; renderCurrentTab(); });

    if (textFilter) {
      textFilter.addEventListener('input', function(e) {
        state.textFilter = e.target.value;
        updateNotamCards();
      });
    }
    if (textClear) textClear.addEventListener('click', function() { state.textFilter = ''; updateNotamCards(); });

    el.querySelectorAll('[data-nt-filter]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.filterTab = btn.getAttribute('data-nt-filter');
        renderCurrentTab();
      });
    });

    el.querySelectorAll('[data-nt-remove]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var icao = btn.getAttribute('data-nt-remove');
        delete state.manualNotamAirports[icao];
        state.notamAirports = state.notamAirports.filter(function(a) { return a !== icao; });
        delete state.notamCache[icao]; delete state.notamErrors[icao]; delete state.notamLoading[icao];
        saveNotamCache();
        renderCurrentTab();
      });
    });
  }

  // Targeted update for NOTAM cards when text filter changes
  function updateNotamCards() {
    var el = document.getElementById('metbriefing-tab-content');
    if (!el) return;

    var allNotams = [];
    var keys = Object.keys(state.notamCache);
    keys.forEach(function(icao) {
      var d = state.notamCache[icao];
      if (d && d.notams) {
        d.notams.forEach(function(n) {
          var copy = {};
          var nkeys = Object.keys(n);
          for (var i = 0; i < nkeys.length; i++) { copy[nkeys[i]] = n[nkeys[i]]; }
          copy.airportName = d.airportName;
          allNotams.push(copy);
        });
      }
    });

    var filtered = allNotams;
    if (state.filterTab === 'active') filtered = filtered.filter(function(n) { return n.status === 'active'; });
    if (state.filterTab === 'expired') filtered = filtered.filter(function(n) { return n.status === 'expired'; });
    if (state.textFilter.trim()) {
      var q = state.textFilter.toLowerCase();
      filtered = filtered.filter(function(n) {
        return (n.subject && n.subject.toLowerCase().indexOf(q) !== -1) ||
               (n.description && n.description.toLowerCase().indexOf(q) !== -1) ||
               (n.id && n.id.toLowerCase().indexOf(q) !== -1) ||
               (n.icao && n.icao.toLowerCase().indexOf(q) !== -1);
      });
    }

    var filtersEl = el.querySelector('.metbriefing-notam-filters');
    if (!filtersEl) return;

    var existingCards = el.querySelector('.metbriefing-notam-cards');
    var existingNoResults = el.querySelector('.metbriefing-notam-no-results');
    if (existingCards) existingCards.remove();
    if (existingNoResults) existingNoResults.remove();

    var html = '';
    if (filtered.length === 0) {
      html += '<div class="metbriefing-notam-no-results">' + icon('search', 32, 'metbriefing-notam-no-results-icon') +
        '<div class="metbriefing-notam-no-results-text">NOTAM \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B</div></div>';
    } else {
      html += '<div class="metbriefing-notam-cards">';
      filtered.forEach(function(notam) {
        html += '<div class="metbriefing-notam-card metbriefing-notam-card--' + notam.criticality + ' metbriefing-notam-card--' + notam.status + '">' +
          '<div class="metbriefing-notam-card-header">' +
            '<div class="metbriefing-notam-card-id">' +
              '<span class="metbriefing-notam-card-identifier">' + escapeHtml(notam.id) + '</span>' +
              (notam.qcode ? '<span class="metbriefing-notam-qcode-badge">' + escapeHtml(notam.qcode) + '</span>' : '') +
              '<span class="metbriefing-notam-type-badge metbriefing-notam-type-badge--' + notam.type + '">' + escapeHtml(notam.type) + '</span>' +
              '<span class="metbriefing-notam-criticality-badge metbriefing-notam-criticality-badge--' + notam.criticality + '">' + escapeHtml(getCriticalityLabel(notam.criticality)) + '</span>' +
            '</div>' +
            '<div class="metbriefing-notam-card-meta">' +
              '<span class="metbriefing-notam-card-icao">' + escapeHtml(notam.icao) + '</span>' +
              '<span class="metbriefing-notam-status-badge metbriefing-notam-status-badge--' + notam.status + '">' + (notam.status === 'active' ? '\u0410\u043A\u0442\u0438\u0432\u0435\u043D' : '\u0418\u0441\u0442\u0451\u043A') + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="metbriefing-notam-card-subject">' + escapeHtml(notam.subject) + '</div>' +
          '<div class="metbriefing-notam-card-description">' + notam.description.split('\n').map(function(l) { return '<p>' + escapeHtml(l) + '</p>'; }).join('') + '</div>' +
          '<div class="metbriefing-notam-card-dates">' +
            '<div class="metbriefing-notam-date-item">' + icon('clock', 14) + '<span class="metbriefing-notam-date-label">\u0421:</span><span class="metbriefing-notam-date-value">' + formatNotamDate(notam.effectiveFrom) + '</span></div>' +
            '<div class="metbriefing-notam-date-item">' + icon('clock', 14) + '<span class="metbriefing-notam-date-label">\u041F\u043E:</span><span class="metbriefing-notam-date-value">' + formatNotamDate(notam.effectiveTo) + '</span></div>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    }

    // Update filter tab counts
    var filterTabs = el.querySelector('.metbriefing-nt-filter-tabs');
    if (filterTabs) {
      var totalAll = allNotams.length;
      var totalActive = allNotams.filter(function(n) { return n.status === 'active'; }).length;
      var totalExpired = allNotams.filter(function(n) { return n.status === 'expired'; }).length;
      var tabsHtml = '<button class="metbriefing-nt-filter-pill ' + (state.filterTab === 'all' ? 'metbriefing-nt-filter-pill--active' : '') + '" data-nt-filter="all">\u0412\u0441\u0435 <span class="metbriefing-nt-filter-count">' + totalAll + '</span></button>' +
        '<button class="metbriefing-nt-filter-pill ' + (state.filterTab === 'active' ? 'metbriefing-nt-filter-pill--active' : '') + '" data-nt-filter="active">\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0435 <span class="metbriefing-nt-filter-count">' + totalActive + '</span></button>' +
        '<button class="metbriefing-nt-filter-pill ' + (state.filterTab === 'expired' ? 'metbriefing-nt-filter-pill--active' : '') + '" data-nt-filter="expired">\u0418\u0441\u0442\u0451\u043A\u0448\u0438\u0435 <span class="metbriefing-nt-filter-count">' + totalExpired + '</span></button>';
      filterTabs.innerHTML = tabsHtml;
      filterTabs.querySelectorAll('[data-nt-filter]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          state.filterTab = btn.getAttribute('data-nt-filter');
          renderCurrentTab();
        });
      });
    }

    filtersEl.insertAdjacentHTML('afterend', html);
  }

  function addNotamAirport() {
    if (state.notamSearchInput.trim()) {
      var code = state.notamSearchInput.toUpperCase().trim();
      if (code.length === 4 && /^[A-Z]{4}$/.test(code)) {
        state.manualNotamAirports[code] = true;
        if (state.notamAirports.indexOf(code) === -1) state.notamAirports.push(code);
        // Fetch NOTAM for manually added airport
        fetchNotam(code);
      }
      state.notamSearchInput = '';
      renderCurrentTab();
    }
  }

  // ===== Share Handler =====
  function handleShare() {
    var lines = [];
    lines.push('\u2708 \u041F\u041E\u041B\u0401\u0422\u041D\u042B\u0419 \u0411\u0420\u0418\u0424\u0418\u041D\u0413');
    lines.push('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
    lines.push('');
    var routeStr = state.altIcaos.length > 0
      ? (state.depIcao || '----') + ' \u2192 ' + (state.arrIcao || '----') + ' (ALT: ' + state.altIcaos.join(', ') + ')'
      : (state.depIcao || '----') + ' \u2192 ' + (state.arrIcao || '----');
    lines.push('\u041C\u0430\u0440\u0448\u0440\u0443\u0442: ' + routeStr);

    var tzDiff = getTimeDiff(state.depIcao, state.arrIcao);
    if (tzDiff) lines.push('\u0420\u0430\u0437\u043D\u0438\u0446\u0430 \u0432\u0440\u0435\u043C\u0435\u043D\u0438: ' + tzDiff);

    lines.push('');
    // Checklist lines removed — replaced by Weather Maps block
    var readiness = getReadiness();
    lines.push('\u0413\u043E\u0442\u043E\u0432\u043D\u043E\u0441\u0442\u044C: ' + readiness.label);

    var text = lines.join('\n');

    if (navigator.share) {
      navigator.share({ title: '\u041F\u043E\u043B\u0451\u0442\u043D\u044B\u0439 \u0431\u0440\u0438\u0444\u0438\u043D\u0433', text: text }).catch(function() {
        copyToClipboard(text);
      });
    } else {
      copyToClipboard(text);
    }
  }

  function copyToClipboard(text) {
    try {
      navigator.clipboard.writeText(text).then(function() {
        app.showToast('\u0411\u0440\u0438\u0444\u0438\u043D\u0433 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D \u0432 \u0431\u0443\u0444\u0435\u0440 \u043E\u0431\u043C\u0435\u043D\u0430');
      }).catch(function() {
        app.showToast('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C');
      });
    } catch(e) {
      app.showToast('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C');
    }
  }

  // ===== Route Change Handler =====
  function onRouteChange() {
    state.prevRoute = getAllRouteAirports().join(',');
    saveRouteInfo();
  }

  // Auto-refresh removed — updates only via header refresh icon (all airports + NOTAM)
  // or per-airport refresh buttons (single airport METAR+TAF)

  // ═══════════════════════════════════════════
  //  HEADER
  // ═══════════════════════════════════════════

  function renderHeader() {
    var left = document.getElementById('headerLeft');
    var center = document.getElementById('headerCenter');
    var right = document.getElementById('headerRight');
    if (!left || !center || !right) return;

    // Task 24 (#4): при ре-рендере header (Shell зовёт renderHeader на каждый init/re-entry)
    // обязательно сбрасываем open state + снимаем listeners — иначе dropdown зависнет открытым.
    closeHeaderMenu();

    left.innerHTML = '<button id="menuBtn" class="icon-btn" aria-label="\u041C\u0435\u043D\u044E" onclick="app.toggleMenu()">'
      + window.ICONS.menu + '</button>';
    left.onclick = null;

    center.innerHTML = '<div class="hc-module">\u041C\u0435\u0442\u0435\u043E\u0431\u0440\u0438\u0444\u0438\u043D\u0433</div>';

    right.innerHTML = '<button id="mbHeaderMenuBtn" class="icon-btn" aria-label="\u041C\u0435\u043D\u044E \u043E\u0447\u0438\u0441\u0442\u043A\u0438" aria-haspopup="true" aria-expanded="false">' + icon('ellipsis-vertical', 22) + '</button>';
    right.onclick = null;

    // Toggle dropdown on button click
    var menuBtn = document.getElementById('mbHeaderMenuBtn');
    if (menuBtn) {
      menuBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var dropdown = document.getElementById('mbHeaderMenuDropdown');
        if (!dropdown) return;
        var isOpen = dropdown.classList.toggle('metbriefing-header-menu--open');
        menuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        var overlay = document.getElementById('mbHeaderMenuOverlay');
        if (overlay) {
          if (isOpen) overlay.classList.add('metbriefing-header-menu-overlay--visible');
          else overlay.classList.remove('metbriefing-header-menu-overlay--visible');
        }
        // Task 24 (#7, #8): §8 attach-on-open / detach-on-close + setTimeout(0)
        if (isOpen) {
          // Вешаем document listeners (вне container — фиксированный overlay/dropdown).
          // setTimeout(0) защищает от немедленного срабатывания на тот же клик (§8 условие 3).
          _onHeaderMenuDocClick = function(ev) {
            var ov = document.getElementById('mbHeaderMenuOverlay');
            // Закрываем только если клик не по dropdown, не по btn и не по overlay
            // (overlay клик обрабатывается отдельно в ensureHeaderMenuDropdown)
            if (!dropdown.contains(ev.target) && !menuBtn.contains(ev.target) && !(ov && ov.contains(ev.target))) {
              closeHeaderMenu();
            }
          };
          _onHeaderMenuKeydown = function(ev) {
            if (ev.key === 'Escape') closeHeaderMenu();
          };
          setTimeout(function() {
            if (_onHeaderMenuDocClick) document.addEventListener('click', _onHeaderMenuDocClick);
            if (_onHeaderMenuKeydown) document.addEventListener('keydown', _onHeaderMenuKeydown);
          }, 0);
        } else {
          // Закрыли toggle'ом — снимаем listeners
          closeHeaderMenu();
        }
      });
    }
  }

  // ===== Header Menu: Очистка брифинга (дом + кеш) =====
  function clearBriefingAll() {
    // Очистка маршрута (дом)
    state.depIcao = '';
    state.arrIcao = '';
    state.altIcaos = [];
    state.altInput = '';
    state.extraAirports = [];
    state.manualNotamAirports = {};
    state.notamAirports = [];
    state.prevRoute = '';

    // Очистка кешей в памяти
    state.weatherCache = {};
    state.wxErrors = {};
    state.wxLoading = {};
    state.metarHistory = {};
    state.metarHistoryLoading = {};
    state.notamCache = {};
    state.notamErrors = {};
    state.notamLoading = {};
    state.avwxStation = {};
    state.sigmetCache = null;
    state.sigmetError = null;
    state.sigmetFirFilter = 'route';
    state.wxMapLoaded = {};

    // Очистка blob URL для карт (память), но НЕ трогаем IndexedDB — браузер сам хранит
    Object.keys(state.wxMapCache).forEach(function(url) {
      var c = state.wxMapCache[url];
      if (c && c.blobUrl) {
        try { URL.revokeObjectURL(c.blobUrl); } catch(e) {}
      }
    });
    state.wxMapCache = {};

    // Task 28: Очистка ветровых карт по эшелонам (blob URLs)
    Object.keys(state.windMapCache).forEach(function(lvl) {
      var c = state.windMapCache[lvl];
      if (c && c.blobUrl) {
        try { URL.revokeObjectURL(c.blobUrl); } catch(e) {}
      }
    });
    state.windMapCache = {};
    state.windMapLoaded = {};
    state.windLevel = (getWindMaps() && getWindMaps().defaultLevel) || 340;

    // Очистка localStorage
    try {
      localStorage.removeItem('wx-cache');
      localStorage.removeItem('wx-route');
      localStorage.removeItem('sigmet-cache');
      localStorage.removeItem('notam-cache');
      localStorage.removeItem('station-cache');
      localStorage.removeItem('wx-recent'); // legacy
    } catch(e) {}

    // Очистка IndexedDB wx-map-cache (всё хранилище)
    openWxMapDb().then(function(db) {
      try {
        var tx = db.transaction(WX_MAP_STORE, 'readwrite');
        tx.objectStore(WX_MAP_STORE).clear();
        tx.onerror = function() {};
      } catch(e) {}
    }).catch(function() {});

    // Ре-рендер
    renderRouteCard();
    renderCurrentTab();
    app.showToast('\u0411\u0440\u0438\u0444\u0438\u043D\u0433 \u043E\u0447\u0438\u0449\u0435\u043D');

    // После очистки — НЕ фетчим автоматически. Пользователь нажал «Очистить» — значит хочет чистое
    // состояние. Свежие данные загрузятся при следующем вводе маршрута, или по кнопке «Брифинг готов»,
    // или автоматически по таймеру SIGMET (каждые 1 час — Task 21).
  }

  // Создаёт dropdown-меню в DOM (вызывается один раз при init, persistent)
  function ensureHeaderMenuDropdown(container) {
    if (document.getElementById('mbHeaderMenuDropdown')) return;

    // Task 21: полноэкранный overlay поверх header (z:1099, под dropdown z:1100)
    var overlay = document.createElement('div');
    overlay.id = 'mbHeaderMenuOverlay';
    overlay.className = 'metbriefing-header-menu-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    container.appendChild(overlay);

    var dropdown = document.createElement('div');
    dropdown.id = 'mbHeaderMenuDropdown';
    dropdown.className = 'metbriefing-header-menu';
    dropdown.setAttribute('role', 'menu');
    dropdown.innerHTML =
      '<button class="metbriefing-header-menu-item" role="menuitem" data-mb-clear-all>' +
        icon('trash', 16) + '<span>\u041E\u0447\u0438\u0441\u0442\u043A\u0430 \u0431\u0440\u0438\u0444\u0438\u043D\u0433\u0430</span>' +
      '</button>';
    container.appendChild(dropdown);

    // Клик по overlay → закрыть dropdown (через closeHeaderMenu — снимает listeners)
    overlay.addEventListener('click', function() {
      closeHeaderMenu();
    });

    // Клик по пункту → подтверждение → очистка
    dropdown.addEventListener('click', function(e) {
      var item = e.target.closest('[data-mb-clear-all]');
      if (item) {
        closeHeaderMenu();
        app.showConfirm(
          '\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0431\u0440\u0438\u0444\u0438\u043D\u0433?\n\n\u0411\u0443\u0434\u0443\u0442 \u0443\u0434\u0430\u043B\u0435\u043D\u044B \u043C\u0430\u0440\u0448\u0440\u0443\u0442 \u0438 \u0432\u0441\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 (\u043F\u043E\u0433\u043E\u0434\u0430, NOTAM, SIGMET, \u043A\u0430\u0440\u0442\u044B, \u0441\u0442\u0430\u043D\u0446\u0438\u0438). \u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043D\u0435\u043E\u0431\u0440\u0430\u0442\u0438\u043C\u043E.',
          clearBriefingAll
        );
      }
    });
  }

  // ═══════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════

  function init(params) {
    var container = document.getElementById('metbriefingContainer');
    if (!container) { console.error('\u041A\u043E\u043D\u0442\u0435\u0439\u043D\u0435\u0440 metbriefingContainer \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D!'); return; }

    // Build shell structure — wrap in .module-container per §7 (lang=ru для hyphens)
    container.innerHTML =
        '<div class="module-container" lang="ru">' +
        '<div id="metbriefing-route-card" class="metbriefing-route-card"></div>' +
        '<div id="metbriefing-tab-switcher" class="metbriefing-tab-switcher"></div>' +
        '<div id="metbriefing-tab-content" class="metbriefing-tab-content"></div>' +
        '</div>';

    // Создаём dropdown-меню очистки (один раз, persistent)
    ensureHeaderMenuDropdown(container);

    // Task 24 (#7, #8): §8 — глобальные listeners перенесены в renderHeader (attach-on-open),
    // здесь они больше НЕ вешаются. closeHeaderMenu() снимает их при закрытии/destroy.

    // Event delegation
    // Track weather map image load/error via capture phase (load/error don't bubble)
    container.addEventListener('load', function(e) {
      var img = e.target;
      if (img.tagName === 'IMG' && img.getAttribute('data-wx-map-url')) {
        state.wxMapLoaded[img.getAttribute('data-wx-map-url')] = true;
      }
    }, true);
    container.addEventListener('error', function(e) {
      var img = e.target;
      if (img.tagName === 'IMG' && img.getAttribute('data-wx-map-url')) {
        state.wxMapLoaded[img.getAttribute('data-wx-map-url')] = false;
      }
    }, true);

    container.addEventListener('click', function(e) {
        // Tab pills
        var tabPill = e.target.closest('.metbriefing-tab-pill');
        if (tabPill && tabPill.getAttribute('data-tab')) {
          var targetTab = tabPill.getAttribute('data-tab');
          state.activeTab = targetTab;

          // Tab switching does NOT trigger refresh — just ensure data is loaded if missing
          if (targetTab === 'weather') {
            var wxAirports = getAllRouteAirports().concat(state.extraAirports.filter(function(a) { return getAllRouteAirports().indexOf(a) === -1; }));
            var needMetar = wxAirports.filter(function(icao) { return !state.weatherCache[icao] || !state.weatherCache[icao].metar; });
            var needTaf = wxAirports.filter(function(icao) { return !state.weatherCache[icao] || !state.weatherCache[icao].taf; });
            if (needMetar.length > 0) fetchMetarBatch(needMetar);
            if (needTaf.length > 0) fetchTafBatch(needTaf);
          }

          renderTabSwitcher();
          renderCurrentTab();
          return;
        }

        // Refresh-all button (moved from header to "Брифинг готов" block)
        var refreshAllBtn = e.target.closest('[data-mb-refresh-all]');
        if (refreshAllBtn) {
          refreshAllWeather();
          return;
        }

        // Share button
        var shareBtn = e.target.closest('.metbriefing-share-btn');
        if (shareBtn) {
          handleShare();
          return;
        }

        // NOTAM filter pills
        var ntFilter = e.target.closest('[data-nt-filter]');
        if (ntFilter) {
          state.filterTab = ntFilter.getAttribute('data-nt-filter');
          renderCurrentTab();
          return;
        }

        // NOTAM airport chip remove
        var ntRemove = e.target.closest('[data-nt-remove]');
        if (ntRemove) {
          var rmIcao = ntRemove.getAttribute('data-nt-remove');
          delete state.manualNotamAirports[rmIcao];
          state.notamAirports = state.notamAirports.filter(function(a) { return a !== rmIcao; });
          delete state.notamCache[rmIcao]; delete state.notamErrors[rmIcao]; delete state.notamLoading[rmIcao];
          saveNotamCache();
          renderCurrentTab();
          return;
        }

        // NOTAM tab group toggle (delegated)
        var ntGroupToggle = e.target.closest('[data-nt-group-toggle]');
        if (ntGroupToggle && !e.target.closest('[data-nt-remove]')) {
          var gIcao = ntGroupToggle.getAttribute('data-nt-group-toggle');
          state.expandedNotamTab[gIcao] = !state.expandedNotamTab[gIcao];
          renderCurrentTab();
          return;
        }

        // METAR toggle (delegated)
        var metarToggle = e.target.closest('[data-metar-toggle]');
        if (metarToggle) {
          var mIcao = metarToggle.getAttribute('data-metar-toggle');
          state.expandedMetar[mIcao] = !state.expandedMetar[mIcao];
          renderCurrentTab();
          return;
        }

        // TAF toggle (delegated)
        var tafToggle = e.target.closest('[data-taf-toggle]');
        if (tafToggle) {
          var tIcao = tafToggle.getAttribute('data-taf-toggle');
          state.expandedTaf[tIcao] = !state.expandedTaf[tIcao];
          renderCurrentTab();
          return;
        }

        // NOTAM toggle (delegated)
        var notamToggle = e.target.closest('[data-notam-toggle]');
        if (notamToggle && !e.target.closest('[data-nt-retry]')) {
          var nIcao = notamToggle.getAttribute('data-notam-toggle');
          state.expandedNotam[nIcao] = !state.expandedNotam[nIcao];
          renderCurrentTab();
          return;
        }

        // Wx refresh (inline briefing) — per-airport AVWX METAR+TAF
        var wxRefresh = e.target.closest('[data-wx-refresh]');
        if (wxRefresh) {
          refreshAirportWeather(wxRefresh.getAttribute('data-wx-refresh'));
          return;
        }

        // Wx retry (inline briefing) — per-airport AVWX METAR+TAF
        var wxRetry = e.target.closest('[data-wx-retry]');
        if (wxRetry) {
          refreshAirportWeather(wxRetry.getAttribute('data-wx-retry'));
          return;
        }

        // NOTAM retry (inline briefing)
        var ntRetry = e.target.closest('[data-nt-retry]');
        if (ntRetry) {
          fetchNotam(ntRetry.getAttribute('data-nt-retry'));
          return;
        }

        // Wx card refresh (weather tab) — per-airport AVWX METAR+TAF
        var wxCardRefresh = e.target.closest('[data-wx-card-refresh]');
        if (wxCardRefresh) {
          refreshAirportWeather(wxCardRefresh.getAttribute('data-wx-card-refresh'));
          return;
        }

        // Wx card retry (weather tab) — per-airport AVWX METAR+TAF
        var wxCardRetry = e.target.closest('[data-wx-card-retry]');
        if (wxCardRetry) {
          refreshAirportWeather(wxCardRetry.getAttribute('data-wx-card-retry'));
          return;
        }

        // Wx card remove (weather tab)
        var wxCardRemove = e.target.closest('[data-wx-card-remove]');
        if (wxCardRemove) {
          var removeIcao = wxCardRemove.getAttribute('data-wx-card-remove');
          state.extraAirports = state.extraAirports.filter(function(a) { return a !== removeIcao; });
          delete state.weatherCache[removeIcao]; delete state.wxErrors[removeIcao]; delete state.wxLoading[removeIcao];
          saveWxCache();
          renderCurrentTab();
          return;
        }

        // SIGMET retry (кнопка в error-блоке, не refresh)
        var sigmetRetry = e.target.closest('[data-sigmet-retry]');
        if (sigmetRetry) {
          fetchSigmetData(true);
          return;
        }

        // SIGMET raw text toggle
        var sigmetRawToggle = e.target.closest('[data-sigmet-raw-toggle]');
        if (sigmetRawToggle) {
          var rawIdx = sigmetRawToggle.getAttribute('data-sigmet-raw-toggle');
          var rawEl = container.querySelector('[data-sigmet-raw="' + rawIdx + '"]');
          if (rawEl) {
            rawEl.classList.toggle('metbriefing-sigmet-raw--open');
            sigmetRawToggle.classList.toggle('metbriefing-sigmet-raw-toggle--open');
          }
          return;
        }
    });

    // SIGMET FIR filter dropdown (change event doesn't bubble to click)
    container.addEventListener('change', function(e) {
      var firSelect = e.target.closest('[data-sigmet-fir-select]');
      if (firSelect) {
        state.sigmetFirFilter = firSelect.value;
        renderCurrentTab();
      }
    });

    // Load static data from metbriefing.json FIRST, then proceed with cache/render
    loadMetData(function() {
      // Load cached data
      loadStationCache();
      loadWxCache();
      loadNotamCache();
      loadSigmetCache();
      loadRouteInfo();
      // Clean up legacy 'wx-recent' localStorage key (recentAirports feature removed)
      try { localStorage.removeItem('wx-recent'); } catch(e) {}

      // Ensure PhotoSwipe library is loaded (for weather maps)
      app.ensureLib('photoswipe');

      // Load cached maps from IndexedDB, then fetch fresh ones if stale
      initWxMapCache().then(function() {
        fetchAllWxMaps(false);
      });

      // Task 28: Wind-by-flight-level maps — set default level from config + preload all
      var wcfg = getWindMaps();
      if (wcfg && wcfg.defaultLevel) {
        state.windLevel = wcfg.defaultLevel;
      }
      preloadAllWindMaps(false);

      // Fetch SIGMET data (uses cache if fresh, otherwise fetches from API)
      fetchSigmetData();

      // Fetch missing data for previously entered airports
      var initAirports = getAllRouteAirports();
      if (initAirports.length > 0) {
        fetchAvwxStation(initAirports);
        fetchMetarBatch(initAirports);
        fetchTafBatch(initAirports);
        // Fetch NOTAM once for previously entered airports
        initAirports.forEach(function(icao) {
          if (!state.notamCache[icao] && !state.notamLoading[icao]) {
            fetchNotam(icao);
          }
        });
      }

      state.prevRoute = getAllRouteAirports().join(',');

      // Render
      renderRouteCard();
      renderTabSwitcher();
      renderCurrentTab();

      // No auto-refresh — updates only via header refresh icon or per-airport refresh buttons

      // Tick every 30s to update time displays
      if (state.tickInterval !== null) {
        clearInterval(state.tickInterval);
      }
      state.tickInterval = setInterval(function() {
        if (state.activeTab === 'briefing' || state.activeTab === 'weather') renderCurrentTab();
      }, 30000);

      // Автообновление SIGMET — как карты погоды (каждые SIGMET_STALE_MS = 1 час — Task 21).
      // fetchSigmetData() без forceRefresh сам проверит isStale и фетчит только если устарел.
      if (state.sigmetRefreshInterval !== null) {
        clearInterval(state.sigmetRefreshInterval);
      }
      state.sigmetRefreshInterval = setInterval(function() {
        fetchSigmetData(false);
      }, SIGMET_STALE_MS);

    });
  }

  // ═══════════════════════════════════════════
  //  DESTROY
  // ═══════════════════════════════════════════

  function destroy() {
    if (state.tickInterval !== null) {
      clearInterval(state.tickInterval);
      state.tickInterval = null;
    }
    if (state.sigmetRefreshInterval !== null) {
      clearInterval(state.sigmetRefreshInterval);
      state.sigmetRefreshInterval = null;
    }
    // Task 24 (#4, #7, #8): §8 — закрываем dropdown + overlay + снимаем document listeners.
    // Вызов closeHeaderMenu() покрывает все 3 условия §8 (attach-on-open / detach-on-close / destroy cleanup).
    closeHeaderMenu();
    // Do NOT revoke blob URLs or clear wxMapCache — IndexedDB still holds the blobs,
    // and init() is not called again on re-entry (contract §5). Revoking kills
    // offline map display. Blob URLs live until page unload — that's fine.
  }

  // ═══════════════════════════════════════════
  //  REGISTER
  // ═══════════════════════════════════════════

  window.ModuleRegistry.register('metbriefing', {
    title: '\u041C\u0435\u0442\u0435\u043E\u0431\u0440\u0438\u0444\u0438\u043D\u0433',
    icon: 'cloud-alert',
    init: init,
    renderHeader: renderHeader,
    destroy: destroy
  });

})();
