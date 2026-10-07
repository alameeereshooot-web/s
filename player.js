// ===== المشغل الشامل لـ HLS و MPEG-DASH (ClearKey) و TS و MP4 =====

var hls = null;
var shakaPlayer = null;
var tsPlayer = null;
var cur = { r: -1, i: -1 };
var retryT = null;

var vid = document.getElementById('vid');
var iframeWrap = document.getElementById('iframe-wrap');
var iframePlayer = document.getElementById('iframe-player');
var qm = document.getElementById('qm');
var qBtn = document.getElementById('q-btn');
var loader = document.getElementById('loader');
var chTitle = document.getElementById('ch-title');
var dblHint = document.getElementById('dbl-hint');
var dblTxt = document.getElementById('dbl-txt');
var swInd = document.getElementById('swipe-ind');
var siIcon = document.getElementById('si-icon');
var siBar = document.getElementById('si-bar');
var siLabel = document.getElementById('si-label');
var brightL = document.getElementById('brightness-layer');
var pw = document.getElementById('player-wrap');
var chRows = document.getElementById('ch-rows');
var fitBtn = document.getElementById('fit-btn');
var speedBadge = document.getElementById('speed-badge');
var spdBtn = document.getElementById('spd-btn');

var brightness = parseFloat(localStorage.getItem('brightness') || '0');
brightL.style.opacity = brightness;

// تناسب العرض
var ASPECTS = [{ cls: 'fc', lbl: '↕ عادي' }, { cls: 'fv', lbl: '⛶ ملء' }, { cls: 'ff', lbl: '↔ مفيد' }];
var aspectIdx = parseInt(localStorage.getItem('aspectIdx') || '0');
function applyAspect(i) {
    vid.className = ASPECTS[i].cls;
    fitBtn.textContent = ASPECTS[i].lbl;
    fitBtn.classList.toggle('on', i !== 0);
    localStorage.setItem('aspectIdx', i);
}
function cycleAspect() {
    aspectIdx = (aspectIdx + 1) % ASPECTS.length;
    applyAspect(aspectIdx);
}
applyAspect(aspectIdx);

function showLoader() { loader.style.display = 'flex'; }
function hideLoader() { loader.style.display = 'none'; }
function toast(msg) {
    var t = document.getElementById('err-toast');
    t.textContent = msg;
    t.style.display = 'block';
    setTimeout(function () { t.style.display = 'none'; }, 4000);
}

// تنظيف وتدمير المشغلات الحالية قبل تشغيل بث جديد
async function resetPlayers() {
    if (hls) {
        hls.destroy();
        hls = null;
    }
    if (shakaPlayer) {
        await shakaPlayer.destroy();
        shakaPlayer = null;
    }
    if (tsPlayer) {
        tsPlayer.destroy();
        tsPlayer = null;
    }
    vid.removeAttribute('src');
    vid.load();
}

// تشغيل روابط MPEG-DASH مع فك تشفير ClearKey
async function loadDash(url, clearkeyConfig) {
    showLoader();
    vid.style.display = 'block';
    iframeWrap.style.display = 'none';
    await resetPlayers();

    if (!window.shaka) {
        hideLoader();
        toast('مكتبة Shaka Player غير محملة');
        return;
    }

    shaka.polyfill.installAll();
    if (!shaka.Player.isBrowserSupported()) {
        hideLoader();
        toast('متصفحك لا يدعم تشغيل MPEG-DASH أو DRM');
        return;
    }

    shakaPlayer = new shaka.Player(vid);

    // إعداد مفاتيح ClearKey وتخطي طلب رخص Widevine الخارجية
    var drmConfig = {};
    if (clearkeyConfig && Object.keys(clearkeyConfig).length > 0) {
        drmConfig.clearKeys = clearkeyConfig;
    }

    shakaPlayer.configure({
        drm: drmConfig,
        manifest: {
            dash: {
                ignoreDrmInfo: true // ضروري جداً لتعمل بدون طلب رخصة خارجية
            }
        },
        streaming: {
            bufferingGoal: 10,
            rebufferingGoal: 2
        }
    });

    shakaPlayer.addEventListener('error', function (event) {
        console.error('Shaka error:', event.detail);
        toast('خطأ في تشغيل DASH: ' + (event.detail?.message || 'مشكلة في التشفير أو البث'));
    });

    try {
        await shakaPlayer.load(url);
        hideLoader();
        pw.classList.add('playing');
        vid.play().catch(function () {});
        buildDashQuality();
    } catch (e) {
        hideLoader();
        console.error('Failed to load DASH:', e);
        toast('تعذر فك تشفير أو تشغيل بث DASH');
    }
}

// تشغيل روابط MPEG-TS المباشرة عبر mpegts.js بسلاسة ودون تقطيع
async function loadTs(url) {
  if (!mpegts.isSupported()) {
    toast('المتصفح لا يدعم بث TS');
    return;
  }
  showLoader();
  vid.style.display = 'block';
  iframeWrap.style.display = 'none';
  await resetPlayers();

  tsPlayer = mpegts.createPlayer({
    type: 'mpegts',
    isLive: true,
    url: url
  }, {
    enableWorker: false,             // تعطيل Worker لمنع تقطيع الفريمات على متصفح الهاتف
    lazyLoad: false,
    enableStashBuffer: true,
    stashInitialSize: 384 * 1024,    // مخزون مبدئي متزن (384KB) يبدأ البث سريعاً خلال 2-3 ثوانٍ
    liveBufferLatencyChasing: true,  // تفعيل إدارة المخزون التلقائي
    liveBufferLatencyMaxLatency: 4.5,// أقصى حد للتأخير 4.5 ثوانٍ
    liveBufferLatencyMinRemain: 2.0, // الاحتفاظ دائماً بمخزون أمان ثانيتين يمتص تذبذب النت ويمنع التوقف
    autoCleanupSourceBuffer: true,
    autoCleanupMaxBackwardDuration: 60,
    autoCleanupMinBackwardDuration: 30
  });

  tsPlayer.attachMediaElement(vid);
  tsPlayer.load();

  vid.addEventListener('playing', function() {
    hideLoader();
    pw.classList.add('playing');
  }, { once: true });

  tsPlayer.play().catch(function(e) {
    console.log('Autoplay TS:', e);
  });

  tsPlayer.on(mpegts.Events.ERROR, function(type, detail, info) {
    console.error('TS Error:', type, detail, info);
    hideLoader();
    toast('خطأ في تشغيل قناة TS');
  });
}

// تشغيل روابط HLS
function loadHls(url) {
    showLoader();
    vid.style.display = 'block';
    iframeWrap.style.display = 'none';
    resetPlayers().then(function () {
        if (window.Hls && Hls.isSupported()) {
                        hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                startLevel: -1,                  // اختيار تلقائي سريع للبث
                liveSyncDurationCount: 1,       // تشغيل فوري من أول جزء دون انتظار 3 أجزاء (يحل تأخير الـ 9 ثوانٍ)
                liveMaxLatencyDurationCount: 3,
                maxBufferLength: 8,
                maxMaxBufferLength: 15,
                manifestLoadingTimeOut: 3500,
                manifestLoadingMaxRetry: 2,
                levelLoadingTimeOut: 3500,
                fragLoadingTimeOut: 5000
            });
            hls.loadSource(url);
            hls.attachMedia(vid);
            hls.on(Hls.Events.MANIFEST_PARSED, function () {
                hideLoader();
                pw.classList.add('playing');
                vid.play().catch(function () {});
                buildHlsQuality();
            });
            hls.on(Hls.Events.ERROR, function (e, d) {
                if (d.fatal) {
                    toast('خطأ في الاتصال بقناة HLS');
                    if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        hls.startLoad();
                    } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        hls.recoverMediaError();
                    }
                }
            });
        } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
            vid.src = url;
            vid.addEventListener('loadeddata', function () { hideLoader(); pw.classList.add('playing'); }, { once: true });
            vid.play().catch(function () {});
        } else {
            hideLoader();
            toast('المتصفح لا يدعم بث HLS');
        }
    });
}

// دالة اختيار القناة وتحويلها للمشغل المناسب
function load(ri, ci) {
    if (ri < 0 || ri >= ROWS.length || ci < 0 || ci >= ROWS[ri].channels.length) return;
    cur = { r: ri, i: ci };
    if (retryT) { clearTimeout(retryT); retryT = null; }

    document.querySelectorAll('.ch').forEach(function (b) { b.classList.remove('on'); });
    var btn = document.getElementById('ch-' + ri + '-' + ci);
    if (btn) btn.classList.add('on');

    var ch = ROWS[ri].channels[ci];
    chTitle.textContent = ch.n;
    chTitle.style.display = 'block';

    // تحديث قائمة الجودات اليدوية للقناة إذا كانت موجودة
    buildCustomQualityMenu(ch);

    // اختيار الرابط: يبدأ بالجودة الأقل إذا أضيفت قائمة qualities أو بالرابط الرئيسي u
    var targetUrl = (ch.qualities && ch.qualities.length > 0) ? ch.qualities[0].src : ch.u;

    // تسريع: تحويل الروابط تلقائياً لأسرع طريق
    var DENO = 'https://sho.alameeereshooot-web.deno.net/?url=';
    
    var finalUrl = targetUrl;
    var isMpd = targetUrl.indexOf('.mpd') !== -1;
    var isMp4 = targetUrl.indexOf('.mp4') !== -1;
    var alreadyProxied =
    targetUrl.indexOf('deno.net') !== -1 ||
    targetUrl.indexOf('l.alameeeretv.workers.dev') !== -1;
    var needProxy = !alreadyProxied && !isMpd && !isMp4 && (
        targetUrl.indexOf('http://') === 0 ||
        targetUrl.indexOf('sharkhost.xyz') !== -1 ||
        targetUrl.indexOf('blcco.linkip.org') !== -1 ||
        /\.ts(\?|$)/i.test(targetUrl)
    );
    if (needProxy) {
        var m3u8Url = targetUrl.replace(/\.ts(\?|$)/i, '.m3u8$1');
        finalUrl = DENO + encodeURIComponent(m3u8Url);
        loadHls(finalUrl);
        return;
    }

    var type = ch.t || (targetUrl.includes('.mpd') ? 'dash' : (targetUrl.includes('.mp4') ? 'mp4' : 'hls'));

    if (type === 'dash') {
        loadDash(targetUrl, ch.clearkey);
    } else if (type === 'iframe') {
        resetPlayers();
        vid.style.display = 'none';
        iframeWrap.style.display = 'block';
        iframePlayer.src = targetUrl;
        pw.classList.add('playing');
    } else if (type === 'mp4') {
        showLoader();
        vid.style.display = 'block';
        iframeWrap.style.display = 'none';
        resetPlayers().then(function () {
            vid.src = targetUrl;
            vid.addEventListener('loadeddata', function () {
                hideLoader();
                pw.classList.add('playing');
            }, { once: true });
            vid.addEventListener('error', function () {
                hideLoader();
                toast('خطأ في تشغيل ملف MP4');
            }, { once: true });
            vid.play().catch(function () {});
        });
    } else if (type === 'ts') {
        loadTs(targetUrl);
    } else {
        loadHls(finalUrl);
    }
}

// بناء قائمة الجودة الخاصة الممررة مع القناة (لـ beIN وغيرها)
function buildCustomQualityMenu(ch) {
    qm.innerHTML = '';
    if (ch.qualities && ch.qualities.length > 0) {
        ch.qualities.forEach(function (q) {
            var b = document.createElement('button');
            b.textContent = q.label;
            b.onclick = function () {
                var type = ch.t || (q.src.includes('.mpd') ? 'dash' : (q.src.includes('.ts') ? 'ts' : (q.src.includes('.mp4') ? 'mp4' : 'hls')));
                if (type === 'dash') loadDash(q.src, ch.clearkey);
                else if (type === 'ts') loadTs(q.src);
                else if (type === 'mp4') {
                    showLoader();
                    vid.style.display = 'block';
                    iframeWrap.style.display = 'none';
                    resetPlayers().then(function () {
                        vid.src = q.src;
                        vid.addEventListener('loadeddata', function () {
                            hideLoader();
                            pw.classList.add('playing');
                        }, { once: true });
                        vid.addEventListener('error', function () {
                            hideLoader();
                            toast('خطأ في تشغيل ملف MP4');
                        }, { once: true });
                        vid.play().catch(function () {});
                    });
                }
                else loadHls(q.src);
                closeQ();
            };
            qm.appendChild(b);
        });
    }
}

// بناء قائمة الجودة لـ HLS تلقائياً إن لم تكن هناك جودات مخصصة
function buildHlsQuality() {
    if (cur.r !== -1 && cur.i !== -1 && ROWS[cur.r].channels[cur.i].qualities) return;
    qm.innerHTML = '';
    if (!hls || !hls.levels?.length) return;
    var autoBtn = document.createElement('button');
    autoBtn.textContent = 'تلقائي';
    autoBtn.onclick = function () { hls.currentLevel = -1; closeQ(); };
    qm.appendChild(autoBtn);

    hls.levels.forEach(function (lv, i) {
        var b = document.createElement('button');
        b.textContent = lv.height ? lv.height + 'p' : Math.round(lv.bitrate / 1000) + 'k';
        b.onclick = function () { hls.currentLevel = i; closeQ(); };
        qm.appendChild(b);
    });
}

// بناء قائمة الجودة لـ DASH تلقائياً مع ترتيبها
function buildDashQuality() {
    if (cur.r !== -1 && cur.i !== -1 && ROWS[cur.r].channels[cur.i].qualities) return;
    qm.innerHTML = '';
    if (!shakaPlayer) return;

    var rawTracks = shakaPlayer.getVariantTracks().filter(function (t) { return t.height; });
    if (!rawTracks.length) return;

    // ترتيب الجودات من الأعلى (1080p) إلى الأقل (288p)
    rawTracks.sort(function (a, b) { return (b.height || 0) - (a.height || 0); });

    // منع تكرار نفس الجودة
    var seen = {};
    var tracks = rawTracks.filter(function (t) {
        if (seen[t.height]) return false;
        seen[t.height] = true;
        return true;
    });

    var autoBtn = document.createElement('button');
    autoBtn.textContent = 'تلقائي';
    autoBtn.onclick = function () {
        shakaPlayer.configure({ abr: { enabled: true } });
        closeQ();
    };
    qm.appendChild(autoBtn);

    tracks.forEach(function (tr) {
        var b = document.createElement('button');
        b.textContent = tr.height + 'p';
        b.onclick = function () {
            shakaPlayer.configure({ abr: { enabled: false } });
            shakaPlayer.selectVariantTrack(tr, true);
            closeQ();
        };
        qm.appendChild(b);
    });
}

function closeQ() { qm.classList.remove('open'); }
function toggleQ() { qm.classList.toggle('open'); }

function togglePlay() { vid.paused ? vid.play() : vid.pause(); }
function toggleMute() {
    vid.muted = !vid.muted;
    document.getElementById('mute-btn').textContent = vid.muted ? '🔇' : '🔊';
    document.getElementById('vs').value = vid.muted ? 0 : vid.volume;
}
function setVolume(v) {
    vid.volume = parseFloat(v);
    vid.muted = v == 0;
    document.getElementById('mute-btn').textContent = v == 0 ? '🔇' : '🔊';
    document.getElementById('vs').value = v;
}
function skip(s) { vid.currentTime += s; }
function reloadCurrentStream() {
    if (cur.r !== -1 && cur.i !== -1) load(cur.r, cur.i);
}

// إعداد كامل الشاشة مع الدوران وتجاوز نتوء الكاميرا
function doFullscreen() {
    var isFs = document.fullscreenElement || document.webkitFullscreenElement || pw.classList.contains('fullscreen-fallback');
    if (isFs) {
        if (document.exitFullscreen) {
            document.exitFullscreen().catch(function () {});
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen().catch(function () {});
        }
        pw.classList.remove('fullscreen-fallback');
        if (screen.orientation && screen.orientation.unlock) {
            try { screen.orientation.unlock(); } catch (e) {}
        }
    } else {
        var req = pw.requestFullscreen || pw.webkitRequestFullscreen;
        if (req) {
            var p = req.call(pw, { navigationUI: 'hide' });
            if (p && p.then) {
                p.then(function () {
                    if (screen.orientation && screen.orientation.lock) {
                        screen.orientation.lock('landscape').catch(function () {});
                    }
                }).catch(function () {});
            } else {
                if (screen.orientation && screen.orientation.lock) {
                    screen.orientation.lock('landscape').catch(function () {});
                }
            }
        } else if (vid.webkitEnterFullscreen) {
            vid.webkitEnterFullscreen();
        } else {
            pw.classList.add('fullscreen-fallback');
            if (screen.orientation && screen.orientation.lock) {
                screen.orientation.lock('landscape').catch(function () {});
            }
        }
    }
}

// إلغاء قفل التدوير تلقائياً عند الخروج من ملء الشاشة
['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
    document.addEventListener(ev, function () {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            pw.classList.remove('fullscreen-fallback');
            if (screen.orientation && screen.orientation.unlock) {
                try { screen.orientation.unlock(); } catch (e) {}
            }
        }
    });
});

// ===== إيماءات اللمس: الصوت (يمين)، الإضاءة (يسار)، النقر المزدوج (ملء الشاشة) =====
var touchStartX = 0;
var touchStartY = 0;
var touchSide = '';
var isSwiping = false;
var initialVal = 0;
var swipeTimer = null;
var lastTapTime = 0;
var singleTapTimer = null;

function showSwipeIndicator(icon, label, pct, color) {
    if (!swInd) return;
    siIcon.textContent = icon;
    siLabel.textContent = label + ' ' + Math.round(pct) + '%';
    siBar.style.width = Math.min(100, Math.max(0, pct)) + '%';
    siBar.style.background = color || '#38bdf8';
    swInd.style.display = 'flex';
    clearTimeout(swipeTimer);
    swipeTimer = setTimeout(function () {
        swInd.style.display = 'none';
    }, 900);
}

function showDblHint(txt) {
    if (!dblHint || !dblTxt) return;
    dblTxt.textContent = txt;
    dblHint.classList.add('show');
    setTimeout(function () {
        dblHint.classList.remove('show');
    }, 800);
}

pw.addEventListener('touchstart', function (e) {
    if (e.target.closest('#controls-overlay button, #controls-overlay input, #qm')) return;

    if (e.touches.length === 1) {
        var t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        isSwiping = false;

        var rect = pw.getBoundingClientRect();
        var relX = t.clientX - rect.left;

        // النصف الأيمن للصوت، والنصف الأيسر للإضاءة
        if (relX > rect.width / 2) {
            touchSide = 'vol';
            initialVal = vid.muted ? 0 : vid.volume;
        } else {
            touchSide = 'bright';
            var curOp = parseFloat(brightL.style.opacity || '0');
            initialVal = Math.round((1 - (curOp / 0.85)) * 100);
        }
    }
}, { passive: true });

pw.addEventListener('touchmove', function (e) {
    if (e.touches.length !== 1 || !touchSide) return;
    var t = e.touches[0];
    var deltaY = touchStartY - t.clientY; // سحب للأعلى = زيادة
    var deltaX = t.clientX - touchStartX;

    if (!isSwiping && Math.abs(deltaY) > 8 && Math.abs(deltaY) > Math.abs(deltaX)) {
        isSwiping = true;
    }

    if (isSwiping) {
        var rect = pw.getBoundingClientRect();
        var changePct = (deltaY / (rect.height * 0.7)) * 100;

        if (touchSide === 'vol') {
            var newVol = Math.min(1, Math.max(0, initialVal + (changePct / 100)));
            vid.volume = newVol;
            vid.muted = newVol === 0;
            var vs = document.getElementById('vs');
            if (vs) vs.value = newVol;
            var muteBtn = document.getElementById('mute-btn');
            if (muteBtn) muteBtn.textContent = newVol === 0 ? '🔇' : (newVol < 0.5 ? '🔉' : '🔊');
            showSwipeIndicator(newVol === 0 ? '🔇' : '🔊', 'الصوت', newVol * 100, '#38bdf8');
        } else if (touchSide === 'bright') {
            var newBright = Math.min(100, Math.max(5, initialVal + changePct));
            var newOpacity = ((100 - newBright) / 100) * 0.85;
            brightL.style.opacity = newOpacity;
            localStorage.setItem('brightness', newOpacity);
            showSwipeIndicator('☀️', 'الإضاءة', newBright, '#facc15');
        }
    }
}, { passive: true });

pw.addEventListener('touchend', function (e) {
    if (isSwiping) {
        touchSide = '';
        isSwiping = false;
        return;
    }

    if (e.target.closest('#controls-overlay button, #controls-overlay input, #qm')) return;

    var now = Date.now();
    if (now - lastTapTime < 300) {
        // نقر مزدوج سريع: شاشة كاملة مع الدوران
        clearTimeout(singleTapTimer);
        lastTapTime = 0;
        doFullscreen();
        showDblHint(document.fullscreenElement ? '⛶ خروج من ملء الشاشة' : '⛶ ملء الشاشة مع الدوران');
    } else {
        // نقرة واحدة: إظهار أو إخفاء أزرار التحكم
        lastTapTime = now;
        singleTapTimer = setTimeout(function () {
            pw.classList.toggle('show-ctrl');
        }, 300);
    }
    touchSide = '';
});

// بناء واجهة القنوات
function buildChannels() {
    chRows.innerHTML = '';
    ROWS.forEach(function (row, ri) {
        var rDiv = document.createElement('div');
        rDiv.className = 'ch-row';
        rDiv.innerHTML = '<div class="row-label"><span>' + (row.icon || '📺') + '</span><span>' + row.label + '</span></div>';
        var scroll = document.createElement('div');
        scroll.className = 'row-scroll';

        row.channels.forEach(function (c, ci) {
            var b = document.createElement('button');
            var cls = 'ch';
            if (c.t === 'dash') cls += ' dash-ch';
            if (c.t === 'ts') cls += ' ts-ch';
            if (c.t === 'iframe') cls += ' iframe-ch';
            if (c.t === 'mp4') cls += ' mp4-ch';
            b.className = cls;
                            if (ri === 0) {
          b.classList.add('bein-logo-ch');
          var img = document.createElement('img');
          img.src = 'bein-' + (ci + 1) + '.png';
          img.alt = c.n;
          b.appendChild(img);
        } else if (row.label && row.label.indexOf('ثمانية') !== -1) {
          b.style.display = 'inline-flex';
          b.style.alignItems = 'center';
          b.style.gap = '6px';
          var img = document.createElement('img');
          img.src = 'thamanya.png';
          img.alt = 'ثمانية';
          img.style.width = '18px';
          img.style.height = '18px';
          img.style.objectFit = 'contain';
          var txt = document.createElement('span');
          txt.textContent = c.n.replace(/^ثمانية\s*/, '');
          b.appendChild(img);
          b.appendChild(txt);
        } else {
          b.textContent = c.n;
        }
            b.id = 'ch-' + ri + '-' + ci;
            b.onclick = function () { load(ri, ci); };
            scroll.appendChild(b);
        });
        rDiv.appendChild(scroll);
        chRows.appendChild(rDiv);
    });
}

// بدء التشغيل
buildChannels();
if (ROWS.length && ROWS[0].channels.length) {
    load(0, 0);
}
