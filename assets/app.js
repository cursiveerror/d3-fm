    // ================================================================
    //  CONSTANTS & DOM REFS
    // ================================================================
    const API_URL =
      'https://de1.api.radio-browser.info/json/stations/search' +
      '?country=Ukraine&hidebroken=true&order=clickcount&reverse=true';

    // Жанри, які ми хочемо виділити в сайдбарі
    const GENRE_WHITELIST = [
      'favorites', 'pop', 'rock', 'news', 'electronic', 'jazz', 'rap',
      'dance', 'classical', 'folk', 'ambient', 'talk',
      'hits', 'chillout', 'lounge', 'techno', 'house'
    ];

    const audio = document.getElementById('player');
    const playBtn = document.getElementById('play-btn');
    const muteBtn = document.getElementById('mute-btn');
    const playerStation = document.getElementById('player-station');
    const playerSong = document.getElementById('player-song');
    const stationsArea = document.getElementById('stations-area');
    const loadingMsg = document.getElementById('loading-msg');
    const sidebar = document.getElementById('sidebar');
    const genreBarMobile = document.getElementById('genre-bar-mobile');

    // ================================================================
    //  STATE
    // ================================================================
    let allStations = [];   // Після дедуплікації
    let genreMap = {};   // { genre: [station, ...] }
    let currentGenre = 'all';
    let currentStation = null;
    let hlsInstance = null;
    let isPlaying = false;
    let isMuted = false;
    let savedVolume = 0.8;
    let favorites = JSON.parse(localStorage.getItem('d3fm_favorites')) || [];

    // ================================================================
    //  1. DEDUPLICATION — залишаємо найкращий bitrate
    // ================================================================
    function deduplicateStations(stations) {
      const map = new Map();

      stations.forEach((s) => {
        const key = s.name.trim().toLowerCase();

        if (!map.has(key)) {
          map.set(key, s);
        } else {
          // Залишаємо станцію з вищим bitrate
          const existing = map.get(key);
          if ((s.bitrate || 0) > (existing.bitrate || 0)) {
            map.set(key, s);
          }
        }
      });

      return Array.from(map.values());
    }

    // ================================================================
    //  2. GENRE EXTRACTION — парсимо tags, рахуємо популярні
    // ================================================================
    function buildGenreMap(stations) {
      const map = {
        all: stations,
        favorites: stations.filter(s => favorites.includes(s.stationuuid))
      };

      stations.forEach((s) => {
        if (!s.tags) return;

        // tags — рядок через кому
        const tags = s.tags.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);

        tags.forEach((tag) => {
          if (GENRE_WHITELIST.includes(tag)) {
            if (!map[tag]) map[tag] = [];
            map[tag].push(s);
          }
        });
      });

      return map;
    }

    // ================================================================
    //  3. SONG METADATA — шукаємо що доступно
    // ================================================================
    function getSongInfo(station) {
      // Radio-Browser іноді повертає поле codec або homepage,
      // але не має live metadata — виводимо заглушку
      if (station.last_changetime_iso8601) {
        return 'Прямий ефір';
      }
      return 'Прямий ефір';
    }

    // ================================================================
    //  RENDER — Genre buttons
    // ================================================================
    // Lucide icon name → genre label
    const GENRE_CONFIG = {
      all: { icon: 'radio', label: 'Усі' },
      favorites: { icon: 'heart', label: 'Улюблене' },
      pop: { icon: 'mic', label: 'Pop' },
      rock: { icon: 'guitar', label: 'Rock' },
      news: { icon: 'newspaper', label: 'News' },
      electronic: { icon: 'cpu', label: 'Electronic' },
      jazz: { icon: 'music', label: 'Jazz' },
      rap: { icon: 'mic-vocal', label: 'Rap' },
      dance: { icon: 'disc-3', label: 'Dance' },
      classical: { icon: 'music-2', label: 'Classical' },
      folk: { icon: 'music-4', label: 'Folk' },
      ambient: { icon: 'moon', label: 'Ambient' },
      talk: { icon: 'message-circle', label: 'Talk' },
      hits: { icon: 'star', label: 'Hits' },
      chillout: { icon: 'snowflake', label: 'Chillout' },
      lounge: { icon: 'wine', label: 'Lounge' },
      techno: { icon: 'zap', label: 'Techno' },
      house: { icon: 'home', label: 'House' },
    };

    function renderGenres() {
      // Будуємо впорядкований список жанрів: спочатку "all", потім по кількості
      const orderedGenres = ['all'];
      GENRE_WHITELIST.forEach(g => {
        if (genreMap[g] && genreMap[g].length > 0) orderedGenres.push(g);
      });

      const makeBtn = (genre) => {
        const btn = document.createElement('button');
        btn.className = 'genre-btn' + (genre === currentGenre ? ' genre-btn--active' : '');
        btn.dataset.genre = genre;

        const cfg = GENRE_CONFIG[genre] || { icon: 'radio', label: genre };
        const count = genreMap[genre] ? genreMap[genre].length : 0;

        btn.innerHTML = `<span class="genre-btn__icon"><i data-lucide="${cfg.icon}"></i></span>${cfg.label}<span class="genre-btn__count">${count}</span>`;

        btn.addEventListener('click', () => {
          currentGenre = genre;
          renderGenres();
          renderStations();
        });

        return btn;
      };

      // Desktop sidebar
      sidebar.querySelectorAll('.genre-btn').forEach(b => b.remove());
      orderedGenres.forEach(g => sidebar.appendChild(makeBtn(g)));

      // Mobile bar
      genreBarMobile.innerHTML = '';
      orderedGenres.forEach(g => genreBarMobile.appendChild(makeBtn(g)));

      // Re-render Lucide icons inside buttons
      lucide.createIcons();
    }

    // ================================================================
    //  RENDER — Station cards
    // ================================================================
    function renderStations() {
      const searchInput = document.getElementById('station-search');
      const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

      let stations = genreMap[currentGenre] || [];

      if (query) {
        stations = stations.filter(s =>
          s.name.toLowerCase().includes(query) ||
          (s.tags && s.tags.toLowerCase().includes(query))
        );
      }

      const cfg = GENRE_CONFIG[currentGenre] || { icon: 'radio', label: currentGenre };

      // Заголовок
      let html = `
        <div class="stations-area__head">
          <div class="stations-area__title">${cfg.label}${query ? ' (Пошук)' : ''}</div>
          <div class="stations-area__count">${stations.length} станцій</div>
        </div>
        <div class="stations-grid" id="stations-grid"></div>
      `;

      stationsArea.innerHTML = html;
      const grid = document.getElementById('stations-grid');

      stations.forEach((s) => {
        const card = document.createElement('div');
        card.className = 'station-card' +
          (currentStation && currentStation.stationuuid === s.stationuuid ? ' station-card--active' : '');
        card.dataset.uuid = s.stationuuid;

        // Іконка (favicon або Lucide fallback)
        const iconContent = s.favicon
          ? `<img src="${s.favicon}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<i data-lucide=radio></i>';lucide.createIcons({nameAttr:'data-lucide',attrs:{class:'lucide-fallback'}})">`
          : '<i data-lucide="radio"></i>';

        const bitrateMatch = s.name.match(/(\d{2,3})\s*(kbps|kb\/s)/i);
        let extractedBitrate = 0;
        let cleanName = s.name;

        if (bitrateMatch) {
          extractedBitrate = parseInt(bitrateMatch[1], 10);
          // Видаляємо знайдений бітрейт із назви (також прибираємо зайві дефіси в кінці)
          cleanName = cleanName.replace(bitrateMatch[0], '').replace(/\s*[-|]\s*$/, '').trim();
        }

        const apiBitrate = parseInt(s.bitrate, 10);
        const finalBitrate = (apiBitrate && apiBitrate > 0) ? apiBitrate : extractedBitrate;
        const bitrateLabel = finalBitrate > 0 ? finalBitrate + ' kbps' : '';

        const isFav = favorites.includes(s.stationuuid);
        card.innerHTML = `
          <div class="station-card__icon">${iconContent}</div>
          <div class="station-card__info">
            <div class="station-card__name">${escapeHtml(cleanName)}</div>
            <div class="station-card__meta">${escapeHtml(s.tags ? s.tags.split(',').slice(0, 3).join(', ') : '')}</div>
          </div>
          ${bitrateLabel ? `<span class="station-card__bitrate">${bitrateLabel}</span>` : ''}
          <button class="fav-btn" data-uuid="${s.stationuuid}" title="Додати в улюблене">
            <i data-lucide="heart" class="${isFav ? 'fav-active' : ''}"></i>
          </button>
        `;

        card.addEventListener('click', () => playStation(s));

        const favBtn = card.querySelector('.fav-btn');
        favBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const uuid = favBtn.dataset.uuid;
          if (favorites.includes(uuid)) {
            favorites = favorites.filter(id => id !== uuid);
          } else {
            favorites.push(uuid);
          }
          localStorage.setItem('d3fm_favorites', JSON.stringify(favorites));

          // Rebuild favorites in map
          genreMap.favorites = allStations.filter(st => favorites.includes(st.stationuuid));

          // Update sidebar/mobile counts dynamically
          renderGenres();

          if (currentGenre === 'favorites') {
            card.remove(); // smoothly remove card without resetting scroll
          } else {
            const svg = favBtn.querySelector('svg');
            if (svg) {
              if (favorites.includes(uuid)) {
                svg.classList.add('fav-active');
              } else {
                svg.classList.remove('fav-active');
              }
            }
          }

          if (currentStation && currentStation.stationuuid === uuid) {
            updateFavIcons();
          }
        });

        grid.appendChild(card);
      });

      // Render Lucide icons in cards
      lucide.createIcons();
    }

    // ================================================================
    //  PLAYBACK
    // ================================================================
    function setPlayIcon(playing) {
      playBtn.innerHTML = playing
        ? '<i data-lucide="pause"></i>'
        : '<i data-lucide="play"></i>';

      const miniPlayBtn = document.getElementById('mini-play-btn');
      if (miniPlayBtn) {
        miniPlayBtn.innerHTML = playing
          ? '<i data-lucide="pause"></i>'
          : '<i data-lucide="play"></i>';
      }

      const miniPlayer = document.getElementById('mini-player');
      if (miniPlayer) {
        if (playing) {
          miniPlayer.classList.add('mini-player--playing');
        } else {
          miniPlayer.classList.remove('mini-player--playing');
        }
      }

      lucide.createIcons({ nameAttr: 'data-lucide' });
    }

    function setMuteIcon(muted) {
      muteBtn.innerHTML = muted
        ? '<i data-lucide="volume-x"></i>'
        : '<i data-lucide="volume-2"></i>';

      const miniMuteBtn = document.getElementById('mini-mute-btn');
      if (miniMuteBtn) {
        miniMuteBtn.innerHTML = muted
          ? '<i data-lucide="volume-x"></i>'
          : '<i data-lucide="volume-2"></i>';
      }
      lucide.createIcons({ nameAttr: 'data-lucide' });
    }

    function updateFavIcons() {
      if (!currentStation) return;
      const isFav = favorites.includes(currentStation.stationuuid);

      const miniFavBtn = document.getElementById('mini-fav-btn');
      if (miniFavBtn) {
        const svg = miniFavBtn.querySelector('svg');
        if (svg) {
          if (isFav) svg.classList.add('fav-active');
          else svg.classList.remove('fav-active');
        }
      }

      const heroFavBtn = document.getElementById('hero-fav-btn');
      if (heroFavBtn) {
        const svg = heroFavBtn.querySelector('svg');
        if (svg) {
          if (isFav) svg.classList.add('fav-active');
          else svg.classList.remove('fav-active');
        }
      }
    }

    function playStation(station) {
      currentStation = station;

      // Оновлюємо плеєр
      const url = station.url_resolved;

      if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
      }

      const isHlsUrl = url.includes('.m3u8') || (station.codec && station.codec.toUpperCase() === 'HLS');

      if (Hls.isSupported() && isHlsUrl) {
        hlsInstance = new Hls();
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(audio);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, function () {
          audio.play().catch(() => { /* autoplay policy */ });
        });
        hlsInstance.on(Hls.Events.ERROR, function (event, data) {
          if (data.fatal) {
            audio.dispatchEvent(new Event('error'));
          }
        });
      } else {
        // Fallback for native HLS (Safari) or standard streams (MP3/AAC)
        audio.src = url;
        audio.play().catch(() => { /* autoplay policy */ });
      }

      isPlaying = true;

      // UI
      playerStation.textContent = station.name;
      playerSong.textContent = getSongInfo(station);
      setPlayIcon(true);
      playBtn.classList.add('play-btn--playing');

      const miniPlayer = document.getElementById('mini-player');
      const miniStation = document.getElementById('mini-station');
      if (miniPlayer && miniStation) {
        miniStation.textContent = station.name;
      }

      updateFavIcons();

      // Оновлюємо active-картку
      document.querySelectorAll('.station-card').forEach(c => c.classList.remove('station-card--active'));
      const activeCard = document.querySelector(`.station-card[data-uuid="${station.stationuuid}"]`);
      if (activeCard) activeCard.classList.add('station-card--active');

      // Media Session API
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: station.name,
          artist: 'D3.fm',
          album: getSongInfo(station),
          artwork: [
            { src: 'assets/favicon.svg', sizes: '512x512', type: 'image/svg+xml' },
            { src: 'assets/favicon.png', sizes: '512x512', type: 'image/png' }
          ]
        });
      }
    }

    // Play / Pause toggle
    playBtn.addEventListener('click', () => {
      if (!currentStation) return;

      if (isPlaying) {
        audio.pause();
        isPlaying = false;
        setPlayIcon(false);
        playBtn.classList.remove('play-btn--playing');
      } else {
        audio.play().catch(() => { });
        isPlaying = true;
        setPlayIcon(true);
        playBtn.classList.add('play-btn--playing');
      }
    });

    // Media Session API Handlers
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        if (currentStation && !isPlaying) playBtn.click();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (currentStation && isPlaying) playBtn.click();
      });
    }

    // ================================================================
    //  MUTE / UNMUTE
    // ================================================================
    audio.volume = 0.8;

    muteBtn.addEventListener('click', () => {
      if (isMuted) {
        // Unmute — відновлюємо гучність
        audio.volume = savedVolume;
        isMuted = false;
        muteBtn.classList.remove('mute-btn--muted');
        setMuteIcon(false);
      } else {
        // Mute — зберігаємо та вимикаємо
        savedVolume = audio.volume || 0.8;
        audio.volume = 0;
        isMuted = true;
        muteBtn.classList.add('mute-btn--muted');
        setMuteIcon(true);
      }
    });


    const miniPlayBtn = document.getElementById('mini-play-btn');
    if (miniPlayBtn) miniPlayBtn.addEventListener('click', () => playBtn.click());

    const miniMuteBtn = document.getElementById('mini-mute-btn');
    if (miniMuteBtn) miniMuteBtn.addEventListener('click', () => muteBtn.click());

    function toggleFavoriteAction() {
      if (!currentStation) return;
      const uuid = currentStation.stationuuid;
      if (favorites.includes(uuid)) {
        favorites = favorites.filter(id => id !== uuid);
      } else {
        favorites.push(uuid);
      }
      localStorage.setItem('d3fm_favorites', JSON.stringify(favorites));
      genreMap.favorites = allStations.filter(st => favorites.includes(st.stationuuid));
      renderGenres();

      updateFavIcons();

      if (currentGenre === 'favorites') {
        renderStations(); // Re-render the whole list to remove the card if needed
      } else {
        // Update the heart in the list if visible
        const listFavBtn = document.querySelector(`.station-card[data-uuid="${uuid}"] .fav-btn svg`);
        if (listFavBtn) {
          if (favorites.includes(uuid)) listFavBtn.classList.add('fav-active');
          else listFavBtn.classList.remove('fav-active');
        }
      }
    }

    const miniFavBtn = document.getElementById('mini-fav-btn');
    if (miniFavBtn) miniFavBtn.addEventListener('click', toggleFavoriteAction);

    const heroFavBtn = document.getElementById('hero-fav-btn');
    if (heroFavBtn) heroFavBtn.addEventListener('click', toggleFavoriteAction);

    // Scroll Listener for Mini Player and Scroll-to-top
    window.addEventListener('scroll', () => {
      const miniPlayer = document.getElementById('mini-player');
      if (miniPlayer) {
        if (window.scrollY > 200) {
          miniPlayer.classList.add('mini-player--visible');
        } else {
          miniPlayer.classList.remove('mini-player--visible');
        }
      }

      const scrollTopBtn = document.getElementById('scroll-to-top');
      if (scrollTopBtn) {
        if (window.scrollY > 400) {
          scrollTopBtn.classList.add('visible');
        } else {
          scrollTopBtn.classList.remove('visible');
        }
      }
    });

    const scrollTopBtn = document.getElementById('scroll-to-top');
    if (scrollTopBtn) {
      scrollTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    const searchInput = document.getElementById('station-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        renderStations();
      });
    }

    function playNextStation() {
      if (!currentStation) return;
      let stations = genreMap[currentGenre] || allStations;
      if (!stations || stations.length === 0) return;
      
      let currentIndex = stations.findIndex(s => s.stationuuid === currentStation.stationuuid);
      if (currentIndex !== -1) {
        let nextIndex = (currentIndex + 1) % stations.length;
        playStation(stations[nextIndex]);
      }
    }

    function playPrevStation() {
      if (!currentStation) return;
      let stations = genreMap[currentGenre] || allStations;
      if (!stations || stations.length === 0) return;
      
      let currentIndex = stations.findIndex(s => s.stationuuid === currentStation.stationuuid);
      if (currentIndex !== -1) {
        let prevIndex = (currentIndex - 1 + stations.length) % stations.length;
        playStation(stations[prevIndex]);
      }
    }

    // Якщо потік обірвався
    audio.addEventListener('error', () => {
      if (!currentStation) return;
      playerSong.textContent = 'Потік недоступний, перемикаємо...';
      setPlayIcon(false);
      playBtn.classList.remove('play-btn--playing');
      playBtn.classList.add('play-btn--error');
      isPlaying = false;

      setTimeout(() => {
        playBtn.classList.remove('play-btn--error');
        playNextStation();
      }, 1500); // 1.5s delay to show the red button and message
    });

    const prevBtn = document.getElementById('prev-btn');
    if (prevBtn) prevBtn.addEventListener('click', playPrevStation);

    const nextBtn = document.getElementById('next-btn');
    if (nextBtn) nextBtn.addEventListener('click', playNextStation);

    const driveModeBtn = document.getElementById('drive-mode-btn');
    if (driveModeBtn) {
      driveModeBtn.addEventListener('click', () => {
        document.body.classList.toggle('drive-mode');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // ================================================================
    //  HELPERS
    // ================================================================
    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // ================================================================
    //  INIT — Fetch & Render
    // ================================================================
    async function init() {
      try {
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const raw = await res.json();

        if (!raw.length) {
          stationsArea.innerHTML = '<div class="state-msg">Станцій не знайдено.</div>';
          return;
        }

        // 1. Дедуплікація
        allStations = deduplicateStations(raw);

        // 2. Побудова карти жанрів
        genreMap = buildGenreMap(allStations);

        // 3. Рендер
        renderGenres();
        renderStations();

      } catch (err) {
        stationsArea.innerHTML = `
          <div class="state-msg">
            <i data-lucide="alert-triangle" style="width:20px;height:20px;margin-bottom:8px"></i><br>
            Не вдалося завантажити станції.<br>
            <span style="font-size:0.75rem;color:#555">${escapeHtml(err.message)}</span>
          </div>`;
        lucide.createIcons();
        console.error('Init error:', err);
      }
    }

    // Ініціалізуємо Lucide для статичних елементів, потім завантажуємо дані
    lucide.createIcons();
    init();
