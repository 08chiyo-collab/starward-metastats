// ============================================
// 画像プロキシ（CORS回避＋キャッシュ）
// ============================================
async function getImage(request) {
  const url = new URL(request.url);
  const imageUrl = url.searchParams.get('url');

  if (!imageUrl) {
    return new Response('Missing url parameter', { status: 400 });
  }

  const response = await fetch(imageUrl, {
    headers: {
      'Referer': 'https://sres.shengtiangames.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  if (!response.ok) {
    return new Response('Image not found', { status: 404 });
  }

  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'public, max-age=86400');

  return new Response(response.body, {
    status: response.status,
    headers: headers
  });
}

// ============================================
// 週リスト取得関数
// ============================================
async function getWeeksList() {
  const LIST_API = "https://xzy.shengtiangames.com/mini-game/xzy/battle-record/hot-rank-list";
  try {
    const res = await fetch(LIST_API, {
      headers: {
        "game-code": "XZYJP",
        "lang": "ja-jp"
      }
    });
    const json = await res.json();
    if (json.code === 0 && json.data && json.data.length > 0) {
      return json.data.sort((a, b) => b.sort - a.sort);
    }
    return [];
  } catch (_) {
    return [];
  }
}

// ============================================
// ランキングデータ取得関数
// ============================================
async function fetchRankingData(listId, ttScore, mode = 'win_rate') {
  const API_URL =
    `https://xzy.shengtiangames.com/mini-game/xzy/battle-record/hot-rank` +
    `?tt_type=2v2` +
    `&tt_score=${encodeURIComponent(ttScore)}` +
    `&order_field=${mode === 'meta_score' ? 'win_rate' : mode}` +
    `&order_method=DESC` +
    `&list_id=${listId}`;

  try {
    const res = await fetch(API_URL, {
      headers: {
        "game-code": "XZYJP",
        "lang": "ja-jp"
      }
    });
    const json = await res.json();
    return json.data || [];
  } catch (_) {
    return [];
  }
}

// ============================================
// メタスコア計算関数
// ============================================
function calcStats(arr) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
  const std = Math.sqrt(variance);
  return { mean, std };
}

function zScore(value, mean, std) {
  if (std === 0) return 0;
  return (value - mean) / std;
}

function computeMetaScores(data) {
  const winRates = data.map(d => parseFloat(d.win_rate) || 0);
  const pickRates = data.map(d => parseFloat(d.on_rate) || 0);
  const banRates = data.map(d => parseFloat(d.ban_rate) || 0);

  const winStats = calcStats(winRates);
  const pickStats = calcStats(pickRates);
  const banStats = calcStats(banRates);

  return data.map(d => {
    const win = parseFloat(d.win_rate) || 0;
    const pick = parseFloat(d.on_rate) || 0;
    const ban = parseFloat(d.ban_rate) || 0;

    const winZ = zScore(win, winStats.mean, winStats.std);
    const pickZ = zScore(pick, pickStats.mean, pickStats.std);
    const banZ = zScore(ban, banStats.mean, banStats.std);

    const boostedWinZ = Math.sign(winZ) * Math.pow(Math.abs(winZ), 1.3);
    const synergy = Math.max(0, winZ * pickZ);

    const meta = boostedWinZ * 0.4 + pickZ * 0.4 + banZ * 0.2 + synergy * 0.3;
    return { ...d, metaScore: meta };
  });
}

// ============================================
// 履歴データ取得API
// ============================================
async function getCharacterHistory(charName, ttScore, weeks, selectedWeekId) {
  const MAX_WEEKS = 16;
  let startIndex = 0;
  if (selectedWeekId) {
    const foundIndex = weeks.findIndex(w => w.id.toString() === selectedWeekId);
    if (foundIndex !== -1) startIndex = foundIndex;
  }
  const endIndex = Math.min(startIndex + MAX_WEEKS, weeks.length);
  const targetWeeks = weeks.slice(startIndex, endIndex);
  const history = [];

  for (const week of targetWeeks) {
    const data = await fetchRankingData(week.id, ttScore);
    const dataWithMeta = computeMetaScores(data);
    const charData = dataWithMeta.find(d => d.role?.name_jp === charName || d.role?.english_name === charName);

    if (charData) {
      history.push({
        week: week.name || `#${week.id}`,
        win_rate: parseFloat(charData.win_rate) || 0,
        pick_rate: parseFloat(charData.on_rate) || 0,
        ban_rate: parseFloat(charData.ban_rate) || 0,
        meta_score: Math.round((charData.metaScore || 0) * 100)
      });
    } else {
      history.push({
        week: week.name || `#${week.id}`,
        win_rate: null,
        pick_rate: null,
        ban_rate: null,
        meta_score: null
      });
    }
  }

  return history;
}

// ============================================
// メイン関数
// ============================================
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  if (url.pathname === '/image') {
    return await getImage(request);
  }

  if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.png') {
    const imageUrl = 'https://sres.shengtiangames.com/uploads/publisher/60272a4a190dd024f74948bfde765f5a.png';
    const response = await fetch(imageUrl, {
      headers: {
        'Referer': 'https://sres.shengtiangames.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!response.ok) {
      return new Response('Not found', { status: 404 });
    }
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('Content-Type', 'image/x-icon');
    return new Response(response.body, { status: 200, headers: headers });
  }

  if (url.pathname === '/api/history') {
    const charName = url.searchParams.get('char');
    const scoreParam = url.searchParams.get('score') || '8000+';
    const selectedWeekId = url.searchParams.get('week') || null;
    let ttScore;
    if (scoreParam === '8000+' || scoreParam.includes('8000+') || scoreParam === '8000') {
      ttScore = '≥8000';
    } else if (scoreParam === '6000-8000' || scoreParam.includes('6000')) {
      ttScore = '≥6000，＜8000';
    } else {
      ttScore = '≥8000';
    }

    if (!charName) {
      return new Response('Missing char parameter', { status: 400 });
    }

    const weeks = await getWeeksList();
    if (weeks.length === 0) {
      return new Response('No weeks found', { status: 500 });
    }

    const history = await getCharacterHistory(charName, ttScore, weeks, selectedWeekId);
    return new Response(JSON.stringify(history), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  }

  // -----------------------------
  // メイン表示
  // -----------------------------
  const rawScore = decodeURIComponent(
    url.searchParams.get("score") || "8000+"
  ).trim();

  const scoreParam =
    rawScore === "6000-8000" ? "6000-8000" : "8000+";

  const mode = url.searchParams.get("mode") || "win_rate";
  const order = url.searchParams.get("order") || "desc";
  const debug = url.searchParams.get("debug") === "1";
  const selectedWeekId = url.searchParams.get("week") || null;

  let tt_score;
  if (scoreParam === "8000+" || scoreParam.includes("8000+") || scoreParam === "8000") {
    tt_score = "≥8000";
  } else if (scoreParam === "6000-8000" || scoreParam.includes("6000")) {
    tt_score = "≥6000，＜8000";
  }

  const weeks = await getWeeksList();

  if (weeks.length === 0) {
    return new Response("週次リストの取得に失敗しました", { status: 500 });
  }

  let activeWeek = weeks[0];
  if (selectedWeekId) {
    const found = weeks.find(w => w.id.toString() === selectedWeekId);
    if (found) activeWeek = found;
  }

  const listId = activeWeek.id;
  const weekName = activeWeek.name || `週次 #${listId}`;

  const rawData = await fetchRankingData(listId, tt_score, mode);
  const dataWithMeta = computeMetaScores(rawData);

  if (debug) {
    return new Response(JSON.stringify({
      selected_week: listId,
      week_name: weekName,
      count: dataWithMeta.length,
      sample: dataWithMeta.slice(0, 3).map(d => ({
        name: d.role?.name_jp,
        win: d.win_rate,
        pick: d.on_rate,
        ban: d.ban_rate,
        meta: d.metaScore
      }))
    }, null, 2), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (dataWithMeta.length === 0) {
    return new Response("指定された週のデータがありません", { status: 500 });
  }

  const sorted = dataWithMeta.sort((a, b) => {
    let valA, valB;
    if (mode === 'meta_score') {
      valA = a.metaScore || 0;
      valB = b.metaScore || 0;
    } else {
      valA = Number(a[mode] || 0);
      valB = Number(b[mode] || 0);
    }
    return order === "asc" ? valA - valB : valB - valA;
  });

  const newOrder = order === "asc" ? "desc" : "asc";

  const weekOptions = weeks.map(w => {
    const selected = w.id === activeWeek.id ? 'selected' : '';
    const label = `#${w.id} ${w.name || ''}`;
    return `<option value="${w.id}" ${selected}>${label}</option>`;
  }).join("");

  const rows = sorted.map((x, i) => {
    const r = x.role || {};
    const iconUrl = r.avatar_link || "";
    const proxyUrl = `/image?url=${encodeURIComponent(iconUrl)}`;
    const metaScore = x.metaScore || 0;
    const displayMeta = Math.round(metaScore * 100);
    const metaClass = metaScore < 0 ? 'meta-negative' : 'meta';
    const charName = r.name_jp || r.english_name || "不明";
    return `
      <tr>
        <td class="rank">${i + 1}</td>
        <td>
          <div class="char">
            <span class="char-name" data-char="${charName}">${charName}</span>
            <img src="${proxyUrl}" loading="lazy" decoding="async" onerror="this.src='https://via.placeholder.com/44/4a6cff/ffffff?text=?'">
          </div>
        </td>
        <td class="win">${x.win_rate ?? "-"}%</td>
        <td class="pick">${x.on_rate ?? "-"}%</td>
        <td class="ban">${x.ban_rate ?? "-"}%</td>
        <td class="${metaClass}">${displayMeta}</td>
      </tr>
    `;
  }).join("");

  // ============================================
  // 修正済み exportScript（Chart.js 4.x + Zoom 2.x 正しい構造）
  // ============================================
  const exportScript = `
  <script>
    const weekName = ${JSON.stringify(weekName)};
    const CACHE_BUSTER = Date.now();

    function getTableData() {
      const rows = document.querySelectorAll('#rankTable tbody tr');
      const data = [];
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 6) return;
        const name = row.querySelector('.char-name')?.textContent || '';
        const win = cells[2]?.textContent?.replace('%', '') || '0';
        const pick = cells[3]?.textContent?.replace('%', '') || '0';
        const ban = cells[4]?.textContent?.replace('%', '') || '0';
        const meta = parseInt(cells[5]?.textContent) || 0;
        data.push({
          rank: parseInt(cells[0]?.textContent) || 0,
          character: name,
          win_rate: parseFloat(win) || 0,
          pick_rate: parseFloat(pick) || 0,
          ban_rate: parseFloat(ban) || 0,
          meta_score: meta
        });
      });
      return data;
    }

    function downloadCSV() {
      const data = getTableData();
      if (data.length === 0) return;
      const headers = ['Rank', 'Character', 'Win Rate (%)', 'Pick Rate (%)', 'Ban Rate (%)', 'Meta Score'];
      const rows = data.map(d => [d.rank, d.character, d.win_rate, d.pick_rate, d.ban_rate, d.meta_score]);
      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      var safeName = weekName.replace(/[\\s\\/]/g, '_');
      link.download = 'starward_meta_' + safeName + '.csv';
      link.click();
      URL.revokeObjectURL(link.href);
    }

    function downloadJSON() {
      const data = getTableData();
      if (data.length === 0) return;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      var safeName = weekName.replace(/[\\s\\/]/g, '_');
      link.download = 'starward_meta_' + safeName + '.json';
      link.click();
      URL.revokeObjectURL(link.href);
    }

    function downloadPNG() {
      const table = document.getElementById('rankTable');
      if (!table) return;
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      script.onload = function() {
        html2canvas(table, {
          backgroundColor: '#0b0f1a',
          scale: 2,
          useCORS: true,
          allowTaint: true
        }).then(canvas => {
          const link = document.createElement('a');
          var safeName = weekName.replace(/[\\s\\/]/g, '_');
          link.download = 'starward_meta_' + safeName + '.png';
          link.href = canvas.toDataURL('image/png');
          link.click();
        }).catch(err => {
          alert('PNG出力に失敗しました: ' + err.message);
        });
      };
      script.onerror = function() {
        alert('html2canvasの読み込みに失敗しました。ネットワークを確認してください。');
      };
      document.head.appendChild(script);
    }

    let historyChartInstance = null;

    function openHistoryModal(charName) {
      const modal = document.getElementById('historyModal');
      const title = document.getElementById('modalTitle');
      const canvas = document.getElementById('historyChart');
      const loading = document.getElementById('historyLoading');

      if (!modal || !title || !canvas || !loading) {
        console.error('Modal elements not found!');
        return;
      }

      modal.style.display = 'block';
      title.textContent = charName + ' の履歴（16週）';
      loading.style.display = 'block';
      canvas.style.display = 'none';

      const params = new URLSearchParams(window.location.search);
      const scoreParam = params.get('score') || '8000+';
      const weekId = params.get('week') || '';
      fetch('/api/history?char=' + encodeURIComponent(charName) + '&score=' + encodeURIComponent(scoreParam) + '&week=' + encodeURIComponent(weekId))
        .then(res => {
          if (!res.ok) throw new Error('Network response was not ok');
          return res.json();
        })
        .then(data => {
          loading.style.display = 'none';
          canvas.style.display = 'block';
          buildHistoryChart(data, charName);
        })
        .catch(err => {
          loading.style.display = 'none';
          alert('履歴データの取得に失敗しました: ' + err.message);
        });
    }

    function buildHistoryChart(data, charName) {
      const ctx = document.getElementById('historyChart').getContext('2d');

      if (historyChartInstance) {
        historyChartInstance.destroy();
        historyChartInstance = null;
      }

      const filteredData = data.filter(d => d.win_rate !== null);
      if (filteredData.length === 0) {
        alert('このキャラクターの履歴データがありません');
        return;
      }

      const reversedData = [...filteredData].reverse();

      const labels = reversedData.map(d => {
        const parts = d.week.split(' - ');
        if (parts.length === 2) {
          return parts[0].replace(/\\\\/g, '/');
        }
        return d.week;
      });

      const winData = reversedData.map(d => d.win_rate);
      const pickData = reversedData.map(d => d.pick_rate);
      const banData = reversedData.map(d => d.ban_rate);
      const metaData = reversedData.map(d => d.meta_score);
      const metaScaled = metaData.map(v => v / 10);

      function loadLibraries() {
        if (typeof Chart === 'undefined') {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js?v=' + CACHE_BUSTER;
          s.onload = function() {
            console.log('Chart.js 4.4.7 loaded');
            loadDataLabels();
          };
          document.head.appendChild(s);
        } else {
          loadDataLabels();
        }
      }

      function loadDataLabels() {
        if (typeof ChartDataLabels === 'undefined') {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js?v=' + CACHE_BUSTER;
          s.onload = function() {
            loadZoomPlugin();
          };
          document.head.appendChild(s);
        } else {
          loadZoomPlugin();
        }
      }

      function loadZoomPlugin() {
        if (typeof ChartZoom === 'undefined') {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js?v=' + CACHE_BUSTER;
          s.onload = function() {
            console.log('ChartZoom 2.0.1 loaded');
            if (typeof Chart !== 'undefined') {
              Chart.register(ChartZoom);
              console.log('ChartZoom registered');
            }
            renderChart();
          };
          s.onerror = function() {
            console.warn('ChartZoom load failed');
            renderChart();
          };
          document.head.appendChild(s);
        } else {
          renderChart();
        }
      }

      function renderChart() {
        // ★ 正しい構造（修正済み）
        historyChartInstance = new Chart(ctx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              {
                label: '勝率 (%)',
                data: winData,
                borderColor: '#7ee787',
                backgroundColor: 'transparent',
                fill: false,
                tension: 0,
                pointRadius: 5,
                pointHoverRadius: 8,
                pointBackgroundColor: '#7ee787',
                pointBorderColor: '#ffffff'
              },
              {
                label: 'PICK率 (%)',
                data: pickData,
                borderColor: '#7ab7ff',
                backgroundColor: 'transparent',
                fill: false,
                tension: 0,
                pointRadius: 5,
                pointHoverRadius: 8,
                pointBackgroundColor: '#7ab7ff',
                pointBorderColor: '#ffffff'
              },
              {
                label: 'BAN率 (%)',
                data: banData,
                borderColor: '#ff7a7a',
                backgroundColor: 'transparent',
                fill: false,
                tension: 0,
                pointRadius: 5,
                pointHoverRadius: 8,
                pointBackgroundColor: '#ff7a7a',
                pointBorderColor: '#ffffff'
              },
              {
                label: 'META (×10)',
                data: metaScaled,
                borderColor: '#fbbf24',
                backgroundColor: 'transparent',
                fill: false,
                tension: 0,
                borderDash: [5, 5],
                pointRadius: 5,
                pointHoverRadius: 8,
                pointBackgroundColor: '#fbbf24',
                pointBorderColor: '#ffffff'
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                labels: {
                  color: '#ffffff',
                  font: { size: 12 }
                }
              },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    let label = context.dataset.label || '';
                    let value = context.parsed.y;
                    if (context.dataset.label === 'META (×10)') {
                      return label + ': ' + (value * 10).toFixed(0);
                    }
                    return label + ': ' + value.toFixed(1) + '%';
                  }
                }
              },
              datalabels: {
                color: '#ffffff',
                anchor: 'end',
                align: 'top',
                font: { size: 10, weight: 'bold' },
                offset: 4,
                formatter: function(value, context) {
                  var datasetLabel = context.dataset.label;
                  if (datasetLabel === 'META (×10)') {
                    return (value * 10).toFixed(0);
                  }
                  return value.toFixed(1);
                }
              },
              // ★ 正しい構造（修正済み）
              zoom: {
                pan: {
                  enabled: true,
                  mode: 'xy',
                  modifierKey: null   // 修飾キーなしでドラッグ
                },
                zoom: {
                  wheel: {
                    enabled: true,
                    speed: 0.05
                  },
                  mode: 'xy',
                  limits: {
                    x: { minRange: 1, max: 16 },
                    y: { minRange: 5, max: 100 }
                  }
                }
              }
            },
            scales: {
              x: {
                ticks: { color: '#ffffff', maxRotation: 45, font: { size: 10 } },
                grid: { color: 'rgba(255,255,255,0.05)' }
              },
              y: {
                ticks: { color: '#ffffff' },
                grid: { color: 'rgba(255,255,255,0.05)' },
                beginAtZero: true,
                max: 100
              }
            }
          },
          plugins: [ChartDataLabels]
        });
        console.log('Chart rendered with Chart.js 4.x + Zoom 2.x (corrected)');
        console.log('Zoom limits:', historyChartInstance.options.plugins.zoom.zoom.limits);
      }

      loadLibraries();
    }

    function closeHistoryModal() {
      document.getElementById('historyModal').style.display = 'none';
      if (historyChartInstance) {
        historyChartInstance.destroy();
        historyChartInstance = null;
      }
    }

    document.addEventListener('DOMContentLoaded', function() {
      console.log('DOMContentLoaded fired!');

      var table = document.querySelector('#rankTable');
      if (table) {
        table.addEventListener('click', function(e) {
          var target = e.target.closest('.char-name');
          if (target) {
            e.stopPropagation();
            var charName = target.textContent.trim();
            if (charName) {
              openHistoryModal(charName);
            }
          }
        });
      }

      var modal = document.getElementById('historyModal');
      if (modal) {
        modal.addEventListener('click', function(e) {
          if (e.target === this) closeHistoryModal();
        });
      }

      var closeBtn = document.getElementById('modalClose');
      if (closeBtn) {
        closeBtn.addEventListener('click', closeHistoryModal);
      }

      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeHistoryModal();
      });
    });
  </script>
  `;

  return new Response(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>STARWARD META STATS</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
body {
  margin: 0;
  font-family: Inter, sans-serif;
  background: radial-gradient(circle at top, #1a1f2e, #0b0f1a);
  color: #fff;
}
.header {
  padding: 22px 22px 10px;
  text-align: center;
}
.title {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 2px;
}
.subtitle {
  opacity: 0.6;
  font-size: 12px;
  margin-top: 4px;
}
.container {
  width: 92%;
  max-width: 950px;
  margin: auto;
}
.panel {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  flex-wrap: wrap;
}
button {
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.05);
  color: #fff;
  font-size: 15px;
  cursor: pointer;
  transition: 0.2s;
  white-space: nowrap;
}
button:hover {
  background: rgba(255,255,255,0.15);
  transform: translateY(-1px);
}
.score-active {
  background: linear-gradient(135deg, #4a6cff, #6f8cff);
  box-shadow: 0 0 14px rgba(74,108,255,0.5);
  border: 1px solid rgba(120,160,255,0.6);
}
.mode-active-asc {
  background: #f9a8d4;
  color: #0b0f1a;
  font-weight: 600;
  box-shadow: 0 0 14px rgba(249,168,212,0.3);
  border-color: #f9a8d4;
}
.mode-active-desc {
  background: #f59e0b;
  color: #0b0f1a;
  font-weight: 600;
  box-shadow: 0 0 14px rgba(245,158,11,0.4);
  border-color: #f59e0b;
}
.week-select {
  background: rgba(255,255,255,0.08);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 15px;
  font-family: inherit;
  cursor: pointer;
  outline: none;
  min-width: 180px;
}
.week-select:hover {
  background: rgba(255,255,255,0.15);
}
.week-select option {
  background: #1a1f2e;
  color: #fff;
}
.export-group {
  margin: 30px 0 8px;
  gap: 6px;
  opacity: 0.7;
  border-top: 1px solid rgba(255,255,255,0.06);
  padding-top: 20px;
}
.export-btn {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  padding: 5px 12px;
  font-size: 13px;
  border-radius: 6px;
}
.export-btn:hover {
  background: rgba(255,255,255,0.12);
  opacity: 1;
}
.export-label {
  font-size: 12px;
  opacity: 0.5;
  letter-spacing: 0.5px;
}
.table-wrap {
  overflow-x: auto;
}
#rankTable {
  width: auto;
  margin: 15px auto;
  border-collapse: collapse;
  font-size: 16px;
  table-layout: fixed;
  border-radius: 10px;
  overflow: hidden;
}
#rankTable th {
  background: rgba(255,255,255,0.06);
  padding: 4px 2px;
  font-size: 13px;
  letter-spacing: 1px;
  border-right: 1px solid rgba(255,255,255,0.08);
}
#rankTable td {
  padding: 4px 2px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.75);
  border-right: 1px solid rgba(255,255,255,0.08);
  vertical-align: middle;
}
#rankTable th:last-child,
#rankTable td:last-child {
  border-right: none;
}
#rankTable tr:hover {
  background: rgba(255,255,255,0.04);
}
#rankTable th:nth-child(1),
#rankTable td:nth-child(1) { width: 30px; text-align: center; }
#rankTable th:nth-child(2),
#rankTable td:nth-child(2) { width: 90px; }
#rankTable th:nth-child(3),
#rankTable td:nth-child(3),
#rankTable th:nth-child(4),
#rankTable td:nth-child(4),
#rankTable th:nth-child(5),
#rankTable td:nth-child(5) {
  width: 40px;
  text-align: center;
}
#rankTable th:nth-child(6),
#rankTable td:nth-child(6) {
  width: 60px;
  text-align: center;
  font-weight: 600;
}
.char {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
}
.char .char-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.2s;
}
.char .char-name:hover {
  color: #fbbf24;
}
.char img {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  flex-shrink: 0;
  display: block;
  object-fit: cover;
}
.win  { color: #7ee787; }
.pick { color: #7ab7ff; }
.ban  { color: #ff7a7a; }
.meta { color: #fbbf24; }
.meta-negative { color: #ff6b9d; }
.footer {
  text-align: center;
  opacity: 0.4;
  font-size: 11px;
  margin: 10px 0 20px;
}

#historyModal {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.75);
  z-index: 1000;
  backdrop-filter: blur(4px);
}
#historyModal .modal-content {
  background: #1a1f2e;
  max-width: 750px;
  width: 92%;
  margin: 40px auto;
  padding: 24px;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  max-height: 90vh;
  overflow-y: auto;
}
#historyModal .modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  padding-bottom: 12px;
  margin-bottom: 16px;
}
#historyModal .modal-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
#historyModal .modal-close {
  cursor: pointer;
  font-size: 28px;
  opacity: 0.6;
  transition: 0.2s;
  line-height: 1;
}
#historyModal .modal-close:hover {
  opacity: 1;
}
#historyModal .chart-container {
  position: relative;
  height: 320px;
}
#historyModal .loading-text {
  text-align: center;
  padding: 60px 0;
  opacity: 0.6;
}
</style>
</head>
<body>

<div class="header">
  <div class="title">STARWARD META STATS</div>
  <div class="subtitle">${weekName}</div>
</div>

<div class="container">
  <div class="panel">
    <label for="weekSelect" style="opacity:0.7; font-size:14px;">週:</label>
    <select id="weekSelect" class="week-select" onchange="location.href='?score=${encodeURIComponent(scoreParam)}&mode=${mode}&order=${order}&week='+this.value">
      ${weekOptions}
    </select>
  </div>

  <div class="panel">
    <button class="${scoreParam === '6000-8000' ? 'score-active' : ''}"
      onclick="location.href='?score=6000-8000&mode=${mode}&order=${order}&week=${listId}'">
      6000-8000
    </button>
    <button class="${scoreParam === '8000+' ? 'score-active' : ''}"
      onclick="location.href='?score=8000%2B&mode=${mode}&order=${order}&week=${listId}'">
      8000+
    </button>
  </div>

  <div class="panel">
    <button class="${mode === 'win_rate' ? (order === 'asc' ? 'mode-active-asc' : 'mode-active-desc') : ''}"
      onclick="location.href='?score=${encodeURIComponent(scoreParam)}&mode=win_rate&order=${mode === 'win_rate' ? newOrder : 'desc'}&week=${listId}'">
      勝率 ${order === 'asc' ? '▲' : '▼'}
    </button>
    <button class="${mode === 'on_rate' ? (order === 'asc' ? 'mode-active-asc' : 'mode-active-desc') : ''}"
      onclick="location.href='?score=${encodeURIComponent(scoreParam)}&mode=on_rate&order=${mode === 'on_rate' ? newOrder : 'desc'}&week=${listId}'">
      PICK率 ${order === 'asc' ? '▲' : '▼'}
    </button>
    <button class="${mode === 'ban_rate' ? (order === 'asc' ? 'mode-active-asc' : 'mode-active-desc') : ''}"
      onclick="location.href='?score=${encodeURIComponent(scoreParam)}&mode=ban_rate&order=${mode === 'ban_rate' ? newOrder : 'desc'}&week=${listId}'">
      BAN率 ${order === 'asc' ? '▲' : '▼'}
    </button>
    <button class="${mode === 'meta_score' ? (order === 'asc' ? 'mode-active-asc' : 'mode-active-desc') : ''}"
      onclick="location.href='?score=${encodeURIComponent(scoreParam)}&mode=meta_score&order=${mode === 'meta_score' ? newOrder : 'desc'}&week=${listId}'">
      META ${order === 'asc' ? '▲' : '▼'}
    </button>
  </div>

  <div class="table-wrap">
    <table id="rankTable">
      <thead>
        <tr>
          <th>#</th>
          <th>CHARACTER</th>
          <th>WIN</th>
          <th>PICK</th>
          <th>BAN</th>
          <th>META</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>

  <div class="panel export-group">
    <span class="export-label">エクスポート</span>
    <button class="export-btn" onclick="downloadCSV()">CSV</button>
    <button class="export-btn" onclick="downloadJSON()">JSON</button>
    <button class="export-btn" onclick="downloadPNG()">PNG</button>
  </div>

  <div class="footer">META ANALYTICS DASHBOARD</div>
</div>

<div id="historyModal">
  <div class="modal-content">
    <div class="modal-header">
      <h2 id="modalTitle">キャラクター履歴（16週）</h2>
      <span class="modal-close" id="modalClose">&times;</span>
    </div>
    <div class="chart-container">
      <div class="loading-text" id="historyLoading">⏳ データを読み込み中...</div>
      <canvas id="historyChart" style="display:none;"></canvas>
    </div>
  </div>
</div>

${exportScript}

</body>
</html>
`, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8"
    }
  });
}
