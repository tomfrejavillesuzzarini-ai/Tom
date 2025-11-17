// app-invest.js - frontend minimal pour ProjectInvest
document.addEventListener('DOMContentLoaded', () => {
  const search = document.getElementById('search');
  const searchBtn = document.getElementById('search-btn');
  const refreshBtn = document.getElementById('refresh-btn');
  const tbody = document.querySelector('#tickers-table tbody');
  const favList = document.getElementById('fav-list');
  const STORAGE = 'projectinvest_favs_v1';

  const demoSymbols = ['AAPL','MSFT','GOOGL','BNP.PA','AIR.PA','SAN.PA'];

  const saveFavs = (arr) => localStorage.setItem(STORAGE, JSON.stringify(arr));
  const loadFavs = () => { try { return JSON.parse(localStorage.getItem(STORAGE)) || []; } catch { return []; } };

  function renderFavs() {
    const favs = loadFavs();
    favList.innerHTML = favs.length ? favs.map(t => `<li class="fav-item"><span>${t}</span><button class="btn ghost" data-remove="${t}">X</button></li>`).join('') : '<div class="hint">Aucun favori</div>';
  }

  function addFav(ticker) {
    const favs = loadFavs();
    if (!favs.includes(ticker)) { favs.push(ticker); saveFavs(favs); renderFavs(); }
  }
  function removeFav(ticker) {
    const favs = loadFavs().filter(x=>x!==ticker); saveFavs(favs); renderFavs();
  }

  function renderTable(list) {
    tbody.innerHTML = '';
    list.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.symbol}</td>
        <td>${item.name || ''}</td>
        <td>${item.price != null ? item.price.toFixed(2) : '-'}</td>
        <td style="color:${item.changePct>=0? '#7CFC00':'#ff6b6b'}">${item.changePct != null ? item.changePct.toFixed(2) + '%' : '-'}</td>
        <td>${item.volume != null ? item.volume.toLocaleString() : '-'}</td>
        <td>${item.score != null ? item.score.toFixed(1) : '-'}</td>
        <td>
          <button class="btn small" data-fav="${item.symbol}">⭐</button>
          <button class="btn ghost small" data-open="${item.symbol}">Détails</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function fetchQuotes(symbols) {
    try {
      const url = `/api/quotes?symbols=${encodeURIComponent(symbols.join(';'))}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Erreur serveur ' + res.status);
      const data = await res.json();
      return data.data || [];
    } catch (e) {
      console.error(e);
      alert('Erreur récupération données. Vérifie les variables d’environnement et le déploiement.');
      return [];
    }
  }

  async function loadInitial() {
    const list = await fetchQuotes(demoSymbols);
    renderTable(list);
    renderFavs();
  }

  searchBtn.addEventListener('click', async () => {
    const v = search.value.trim();
    if (!v) return alert('Tape un ticker ou une liste séparée par ;');
    const syms = v.includes(';') ? v.split(';').map(s=>s.trim()).filter(Boolean) : [v];
    const list = await fetchQuotes(syms);
    renderTable(list);
  });

  refreshBtn.addEventListener('click', loadInitial);

  tbody.addEventListener('click', (e) => {
    const fav = e.target.getAttribute('data-fav');
    const open = e.target.getAttribute('data-open');
    if (fav) addFav(fav);
    if (open) window.open(`https://www.google.com/search?q=${encodeURIComponent(open + ' cours')}`, '_blank');
  });

  favList.addEventListener('click', (e) => {
    const rem = e.target.getAttribute('data-remove');
    if (rem) removeFav(rem);
  });

  loadInitial();
});