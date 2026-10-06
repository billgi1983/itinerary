/**
 * CJ Map - 主程式與使用者交互控制 (app.js)
 * 整合 DataCenter (models.js) 與 CJMapController (map.js)
 * 實作三欄互動、拖曳排序 (SortableJS)、檔案存讀、CSV 報表與開箱即用功能
 */

document.addEventListener('DOMContentLoaded', () => {

  // ==========================================
  // 1. 初始化全域狀態與地圖控制器
  // ==========================================

  const dataCenter = new DataCenter();
  const mapCtrl = new CJMapController('leaflet-map');

  // 暫存彈窗編輯中的對象指標
  let currentEditingPlace = null;       // 當前挑選圖示或時間的 PlaceModel
  let currentEditingPath = null;        // 當前挑選顏色的 JourneyPathModel
  let currentEditingDay = null;         // 當前挑選日期的 JourneyDay
  let tempIconSelection = { row: 7, col: 5, color: '0' }; // 暫存挑選的圖示
  let tempColorSelection = '6';         // 暫存挑選的路徑顏色

  // ==========================================
  // 2. DOM 元素快取
  // ==========================================

  // 左欄：搜尋與口袋
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const clearSearchBtn = document.getElementById('clear-search-btn');
  const searchResultsList = document.getElementById('search-results-list');

  const favItemsList = document.getElementById('favorite-items-list');
  const favRangeBtn = document.getElementById('fav-range-btn');
  const favToggleShow = document.getElementById('fav-toggle-show');

  // 中欄：旅程規劃
  const btnAddDay = document.getElementById('btn-add-day');
  const btnAddMove = document.getElementById('btn-add-move');
  const btnAddStay = document.getElementById('btn-add-stay');
  const btnAddPath = document.getElementById('btn-add-path');
  const journeyDaysContainer = document.getElementById('journey-days-container');

  // 右欄：頂部控制列
  const inputJourneyName = document.getElementById('input-journey-name');
  const btnShowJourneyRange = document.getElementById('btn-show-journey-range');
  const btnNewJourney = document.getElementById('btn-new-journey');
  const btnSaveJourney = document.getElementById('btn-save-journey');
  const btnLoadJourney = document.getElementById('btn-load-journey');
  const fileInputLoad = document.getElementById('file-input-load');
  const btnMakeReport = document.getElementById('btn-make-report');
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const btnOpenHelp = document.getElementById('btn-open-help');

  // 彈窗元素
  const modalSettings = document.getElementById('modal-settings');
  const modalIconPicker = document.getElementById('modal-icon-picker');
  const modalColorPicker = document.getElementById('modal-color-picker');
  const modalDatetimePicker = document.getElementById('modal-datetime-picker');
  const modalHelp = document.getElementById('modal-help');

  // ==========================================
  // 3. 通用彈窗工具
  // ==========================================

  function openModal(modalEl) {
    if (modalEl) modalEl.classList.add('open');
  }

  function closeModal(modalEl) {
    if (modalEl) modalEl.classList.remove('open');
  }

  // 綁定所有關閉按鈕與點擊背景關閉
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.classList.contains('btn-close-modal')) {
        closeModal(modal);
      }
    });
  });

  // ==========================================
  // 4. 左側搜尋功能 (OpenStreetMap Nominatim 免費服務)
  // ==========================================

  async function executeSearch(query) {
    const q = (query || searchInput.value || '').trim();
    if (!q) return;

    searchResultsList.innerHTML = `<div style="text-align:center; padding: 20px; font-size:11px; color: var(--text-accent);">🔍 正在搜尋「${escapeHTML(q)}」...</div>`;

    try {
      let places = [];

      // 嘗試 1：OpenStreetMap Nominatim 服務
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=12`;
        const res = await fetch(url, {
          headers: { 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' }
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            places = data.map(item => {
              const placeName = item.name || item.display_name.split(',')[0] || q;
              return new PlaceModel({
                place_name: placeName,
                place_nickname: placeName,
                place_lat: parseFloat(item.lat),
                place_lng: parseFloat(item.lon),
                place_address: item.display_name || '',
                place_types: item.type || item.class || '地點',
                place_icon: CJ_CONSTANTS.DEFAULT_ICONS.SEARCH
              });
            });
          }
        }
      } catch (nomErr) {
        console.warn('Nominatim 查詢異常，切換至備用 Photon 開源搜尋服務', nomErr);
      }

      // 嘗試 2：Photon (Komoot) 開源地理搜尋服務 (完全允許跨域與 file:// 本地請求)
      if (places.length === 0) {
        try {
          const pUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=12`;
          const pRes = await fetch(pUrl);
          if (pRes.ok) {
            const pData = await pRes.json();
            if (pData.features && pData.features.length > 0) {
              places = pData.features.map(f => {
                const props = f.properties || {};
                const placeName = props.name || q;
                const addrParts = [props.street, props.district, props.city, props.state, props.country].filter(Boolean);
                const placeAddress = addrParts.length > 0 ? addrParts.join(', ') : placeName;
                return new PlaceModel({
                  place_name: placeName,
                  place_nickname: placeName,
                  place_lat: f.geometry.coordinates[1],
                  place_lng: f.geometry.coordinates[0],
                  place_address: placeAddress,
                  place_types: props.osm_value || '地點',
                  place_icon: CJ_CONSTANTS.DEFAULT_ICONS.SEARCH
                });
              });
            }
          }
        } catch (pErr) {
          console.warn('Photon 搜尋異常', pErr);
        }
      }

      if (places.length === 0) {
        searchResultsList.innerHTML = `<div style="text-align:center; padding: 20px; font-size:11px; color: var(--text-dim);">查無搜尋結果，請嘗試其他關鍵字</div>`;
        dataCenter.search_places = [];
        mapCtrl.clearSearchMarkers();
        return;
      }

      dataCenter.search_places = places;

      // 渲染結果清單與地圖標記
      renderSearchResults();
      mapCtrl.renderSearchMarkers(dataCenter.search_places);

      // 自動縮放視野以包覆搜尋結果
      const coords = dataCenter.search_places.map(p => [p.place_lat, p.place_lng]);
      mapCtrl.layoutMap(coords);

    } catch (err) {
      console.error(err);
      searchResultsList.innerHTML = `<div style="text-align:center; padding: 20px; font-size:11px; color: var(--danger);">搜尋失敗，請檢查網路連線後重試</div>`;
    }
  }

  function renderSearchResults() {
    searchResultsList.innerHTML = '';
    if (dataCenter.search_places.length === 0) {
      searchResultsList.innerHTML = `<div style="text-align:center; color: var(--text-dim); padding: 20px 10px; font-size: 11px;">無搜尋結果</div>`;
      return;
    }

    dataCenter.search_places.forEach(place => {
      const card = document.createElement('div');
      card.className = 'item-card';

      // 標題與簡介
      card.innerHTML = `
        <div class="item-card-title">${escapeHTML(place.place_nickname || place.place_name)}</div>
        <div class="item-card-info">${escapeHTML(place.place_address)}\n類型: ${escapeHTML(place.place_types)}</div>
        <div class="item-card-actions">
          <button class="btn btn-xs btn-open-gmap">網頁顯示</button>
          <button class="btn btn-xs btn-add-favorite">放入口袋</button>
          <span class="dynamic-actions" style="display: flex; gap: 4px;"></span>
        </div>
      `;

      // 綁定網頁顯示 (Google 地圖)
      card.querySelector('.btn-open-gmap').addEventListener('click', () => {
        const gUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.place_name + ' ' + place.place_address)}`;
        window.open(gUrl, '_blank');
      });

      // 綁定放入口袋清單
      card.querySelector('.btn-add-favorite').addEventListener('click', () => {
        addToFavorites(place);
      });

      // 動態按鈕容器（設為起點/設為終點/設為停留）
      const dynamicContainer = card.querySelector('.dynamic-actions');
      populateDynamicButtons(dynamicContainer, place);

      // 滑鼠懸停連動地圖定位
      card.addEventListener('mouseenter', () => {
        if (place.place_lat && place.place_lng) {
          mapCtrl.map.panTo([place.place_lat, place.place_lng], { animate: true });
        }
      });

      searchResultsList.appendChild(card);
    });
  }

  // 清空搜尋
  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    dataCenter.search_places = [];
    searchResultsList.innerHTML = `<div style="text-align:center; color: var(--text-dim); padding: 20px 10px; font-size: 11px;">已清空搜尋結果</div>`;
    mapCtrl.clearSearchMarkers();
  });

  searchBtn.addEventListener('click', () => executeSearch());
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') executeSearch();
  });

  // ==========================================
  // 5. 左側口袋名單功能 (Favorites)
  // ==========================================

  function addToFavorites(placeModel) {
    // 檢查是否重複
    const exists = dataCenter.favorite_places.some(p =>
      p.place_lat === placeModel.place_lat && p.place_lng === placeModel.place_lng
    );
    if (!exists) {
      const favPlace = placeModel.clone();
      favPlace.place_icon = CJ_CONSTANTS.DEFAULT_ICONS.FAVORITE;
      dataCenter.favorite_places.push(favPlace);
    }

    // 從搜尋結果移除該項目
    dataCenter.search_places = dataCenter.search_places.filter(p => p !== placeModel);
    renderSearchResults();
    mapCtrl.renderSearchMarkers(dataCenter.search_places);

    // 重新渲染口袋清單與標記
    renderFavoriteItems();
    mapCtrl.renderFavoriteMarkers(dataCenter.favorite_places, dataCenter.show_favorite);
    autoSaveDraft();
  }

  function removeFromFavorites(placeModel) {
    dataCenter.favorite_places = dataCenter.favorite_places.filter(p => p !== placeModel);
    renderFavoriteItems();
    mapCtrl.renderFavoriteMarkers(dataCenter.favorite_places, dataCenter.show_favorite);
    autoSaveDraft();
  }

  function renderFavoriteItems() {
    favItemsList.innerHTML = '';
    if (dataCenter.favorite_places.length === 0) {
      favItemsList.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 20px 10px; font-size: 11px;">尚未收藏任何景點</div>`;
      return;
    }

    dataCenter.favorite_places.forEach(place => {
      const card = document.createElement('div');
      card.className = 'item-card';

      card.innerHTML = `
        <input type="text" class="input-text nickname-input" value="${escapeHTML(place.place_nickname || place.place_name)}" placeholder="自訂地點別名">
        <div class="item-card-info">${escapeHTML(place.place_address)}\n類型: ${escapeHTML(place.place_types)}</div>
        <textarea class="textarea-box fav-note" placeholder="備忘筆記 (點擊可編輯)...">${escapeHTML(place.place_note || '')}</textarea>
        <div class="item-card-actions">
          <button class="btn btn-xs btn-open-gmap">網頁顯示</button>
          <button class="btn btn-xs btn-danger btn-remove-fav">移出口袋</button>
          <span class="dynamic-actions" style="display: flex; gap: 4px;"></span>
        </div>
      `;

      // 監聽別名更改
      const nickInput = card.querySelector('.nickname-input');
      nickInput.addEventListener('change', (e) => {
        place.place_nickname = e.target.value.trim() || place.place_name;
        mapCtrl.renderFavoriteMarkers(dataCenter.favorite_places, dataCenter.show_favorite);
        autoSaveDraft();
      });

      // 監聽筆記更改
      const noteInput = card.querySelector('.fav-note');
      noteInput.addEventListener('input', (e) => {
        place.place_note = e.target.value;
        autoSaveDraft();
      });

      // 網頁顯示
      card.querySelector('.btn-open-gmap').addEventListener('click', () => {
        const gUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.place_nickname + ' ' + place.place_address)}`;
        window.open(gUrl, '_blank');
      });

      // 移出口袋
      card.querySelector('.btn-remove-fav').addEventListener('click', () => {
        removeFromFavorites(place);
      });

      // 動態帶入起點/終點按鈕
      const dynamicContainer = card.querySelector('.dynamic-actions');
      populateDynamicButtons(dynamicContainer, place);

      favItemsList.appendChild(card);
    });
  }

  // 範圍顯示口袋景點
  favRangeBtn.addEventListener('click', () => {
    mapCtrl.fitFavorites(dataCenter.favorite_places);
  });

  // 口袋名單地圖顯示開關
  favToggleShow.addEventListener('change', (e) => {
    dataCenter.show_favorite = e.target.checked;
    mapCtrl.renderFavoriteMarkers(dataCenter.favorite_places, dataCenter.show_favorite);
  });

  // ==========================================
  // 6. 動態按鈕產生器 (設為起點、設為終點、設為停留)
  // ==========================================

  function populateDynamicButtons(container, placeModel) {
    container.innerHTML = '';
    const activeItem = dataCenter.getActiveItem();
    if (!activeItem) return;

    if (activeItem.type === 'move') {
      const btnStart = document.createElement('button');
      btnStart.className = 'btn btn-xs btn-success';
      btnStart.textContent = '設為起點';
      btnStart.addEventListener('click', () => {
        assignPlaceToItem(activeItem, 'start', placeModel);
      });

      const btnEnd = document.createElement('button');
      btnEnd.className = 'btn btn-xs btn-primary';
      btnEnd.textContent = '設為終點';
      btnEnd.addEventListener('click', () => {
        assignPlaceToItem(activeItem, 'end', placeModel);
      });

      container.appendChild(btnStart);
      container.appendChild(btnEnd);
    } else if (activeItem.type === 'stay') {
      const btnStay = document.createElement('button');
      btnStay.className = 'btn btn-xs btn-success';
      btnStay.textContent = '設為停留';
      btnStay.addEventListener('click', () => {
        assignPlaceToItem(activeItem, 'start', placeModel);
      });
      container.appendChild(btnStay);
    }
  }

  function assignPlaceToItem(journeyItem, targetRole, placeModel) {
    const cloned = placeModel.clone();
    if (targetRole === 'start') {
      cloned.place_icon = journeyItem.placemodel_start.place_icon || '750';
      journeyItem.placemodel_start = cloned;
    } else if (targetRole === 'end') {
      cloned.place_icon = journeyItem.placemodel_end.place_icon || '750';
      journeyItem.placemodel_end = cloned;
    }

    renderJourneyDays();
    mapCtrl.renderJourney(dataCenter.journey_days);
    autoSaveDraft();
  }

  function refreshAllDynamicButtons() {
    renderSearchResults();
    renderFavoriteItems();
  }

  // ==========================================
  // 7. 中間面板：旅程規劃與每日清單 (Journey Days & Items)
  // ==========================================

  btnAddDay.addEventListener('click', () => {
    dataCenter.addNewDay();
    renderJourneyDays();
    mapCtrl.renderJourney(dataCenter.journey_days);
    autoSaveDraft();
  });

  btnAddMove.addEventListener('click', () => {
    const activeDay = dataCenter.getActiveDay() || dataCenter.addNewDay();
    const moveItem = new JourneyMoveModel(new PlaceModel(), new PlaceModel(), {
      currency: dataCenter.default_currency
    });
    activeDay.items.push(moveItem);
    dataCenter.setActiveItem(activeDay.id, moveItem.id, 'move');

    renderJourneyDays();
    refreshAllDynamicButtons();
    autoSaveDraft();
  });

  btnAddStay.addEventListener('click', () => {
    const activeDay = dataCenter.getActiveDay() || dataCenter.addNewDay();
    const stayItem = new JourneyStayModel(new PlaceModel(), new PlaceModel(), {
      currency: dataCenter.default_currency
    });
    activeDay.items.push(stayItem);
    dataCenter.setActiveItem(activeDay.id, stayItem.id, 'stay');

    renderJourneyDays();
    refreshAllDynamicButtons();
    autoSaveDraft();
  });

  btnAddPath.addEventListener('click', () => {
    const activeDay = dataCenter.getActiveDay() || dataCenter.addNewDay();
    const pathItem = new JourneyPathModel(new PlaceModel(), new PlaceModel(), {
      currency: dataCenter.default_currency,
      color: '6'
    });
    activeDay.items.push(pathItem);
    dataCenter.setActiveItem(activeDay.id, pathItem.id, 'path');

    renderJourneyDays();
    refreshAllDynamicButtons();
    autoSaveDraft();
  });

  /**
   * 渲染中欄所有日期卡片與內部行程項目
   */
  function renderJourneyDays() {
    journeyDaysContainer.innerHTML = '';

    if (dataCenter.journey_days.length === 0) {
      journeyDaysContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-dim); padding: 40px 10px; font-size: 11px;">
          尚未建立任何旅程日程<br>點擊上方「新增一日」開始規劃
        </div>
      `;
      return;
    }

    dataCenter.journey_days.forEach((day, dayIndex) => {
      const dayCard = document.createElement('div');
      dayCard.className = `day-card ${dataCenter.active_day_id === day.id ? 'active-day' : ''}`;
      dayCard.dataset.dayId = day.id;

      const weekdayZH = CJUtils.getWeekdayZH(day.date);

      // 每日標題頭
      dayCard.innerHTML = `
        <div class="day-header">
          <div class="day-drag-handle" title="按住拖曳改變日程順序">
            <span class="state-dot ${dataCenter.active_day_id === day.id ? 'active' : ''}"></span>
            <span style="font-weight: 600; font-size: 11px;">Day ${dayIndex + 1}</span>
          </div>
          <button class="day-date-btn" title="點擊修改日期">${escapeHTML(day.date)} (${weekdayZH})</button>
          <div style="display: flex; align-items: center; gap: 4px;">
            <button class="btn btn-xs btn-day-range" title="縮放至當日所有景點">範圍顯示</button>
            <label class="checkbox-label" title="在地圖上顯示/隱藏此日標記">
              <input type="checkbox" class="chk-day-show" ${day.show_on_map ? 'checked' : ''}> 顯示
            </label>
            <button class="btn btn-xs btn-danger btn-delete-day" title="刪除整日行程">✕</button>
          </div>
        </div>
        <div class="day-items-list" data-day-id="${day.id}"></div>
      `;

      // 點擊卡片頭部設定活躍日
      dayCard.querySelector('.day-drag-handle').addEventListener('click', () => {
        dataCenter.active_day_id = day.id;
        renderJourneyDays();
        refreshAllDynamicButtons();
      });

      // 點擊日期按鈕開啓時間設定
      dayCard.querySelector('.day-date-btn').addEventListener('click', () => {
        openDayDatePicker(day);
      });

      // 單日範圍顯示
      dayCard.querySelector('.btn-day-range').addEventListener('click', () => {
        mapCtrl.fitDay(day);
      });

      // 單日顯示/隱藏開關
      dayCard.querySelector('.chk-day-show').addEventListener('change', (e) => {
        day.show_on_map = e.target.checked;
        mapCtrl.renderJourney(dataCenter.journey_days);
        autoSaveDraft();
      });

      // 刪除整日
      dayCard.querySelector('.btn-delete-day').addEventListener('click', () => {
        if (confirm(`確定要刪除 Day ${dayIndex + 1} (${day.date}) 及其所有行程嗎？`)) {
          dataCenter.journey_days = dataCenter.journey_days.filter(d => d !== day);
          if (dataCenter.active_day_id === day.id) {
            dataCenter.active_day_id = dataCenter.journey_days[0]?.id || null;
            dataCenter.active_item_id = null;
          }
          renderJourneyDays();
          mapCtrl.renderJourney(dataCenter.journey_days);
          refreshAllDynamicButtons();
          autoSaveDraft();
        }
      });

      // 渲染每日內部的行程項目列表
      const itemsListContainer = dayCard.querySelector('.day-items-list');
      renderDayItems(itemsListContainer, day);

      // 初始化當日行程項目的 Sortable 拖曳排序
      Sortable.create(itemsListContainer, {
        group: 'journey-items',
        animation: 150,
        handle: '.item-drag-handle',
        onEnd: (evt) => {
          const fromDayId = evt.from.dataset.dayId;
          const toDayId = evt.to.dataset.dayId;
          const fromDay = dataCenter.journey_days.find(d => d.id === fromDayId);
          const toDay = dataCenter.journey_days.find(d => d.id === toDayId);

          if (fromDay && toDay) {
            const [movedItem] = fromDay.items.splice(evt.oldIndex, 1);
            toDay.items.splice(evt.newIndex, 0, movedItem);
            mapCtrl.renderJourney(dataCenter.journey_days);
            autoSaveDraft();
          }
        }
      });

      journeyDaysContainer.appendChild(dayCard);
    });

    // 初始化日程卡片彼此間的 Sortable 拖曳排序
    Sortable.create(journeyDaysContainer, {
      animation: 150,
      handle: '.day-drag-handle',
      onEnd: (evt) => {
        const [movedDay] = dataCenter.journey_days.splice(evt.oldIndex, 1);
        dataCenter.journey_days.splice(evt.newIndex, 0, movedDay);
        renderJourneyDays();
        autoSaveDraft();
      }
    });
  }

  /**
   * 渲染某一日內部的所有項目 (Move / Stay / Path)
   */
  function renderDayItems(container, day) {
    container.innerHTML = '';

    day.items.forEach(item => {
      const isActive = dataCenter.active_item_id === item.id;
      const card = document.createElement('div');
      card.className = `journey-item-card ${isActive ? 'active-item' : ''}`;
      card.dataset.itemId = item.id;

      if (item.type === 'move') {
        renderMoveCardContent(card, item, day);
      } else if (item.type === 'stay') {
        renderStayCardContent(card, item, day);
      } else if (item.type === 'path') {
        renderPathCardContent(card, item, day);
      }

      // 點選卡片設為活躍項目
      card.addEventListener('click', (e) => {
        if (!['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
          dataCenter.setActiveItem(day.id, item.id, item.type);
          renderJourneyDays();
          refreshAllDynamicButtons();
        }
      });

      container.appendChild(card);
    });
  }

  /**
   * 渲染「移動」項目卡片
   */
  function renderMoveCardContent(card, item, day) {
    const s = item.placemodel_start;
    const e = item.placemodel_end;

    card.innerHTML = `
      <!-- 出發點 -->
      <div class="item-row">
        <span class="item-row-label">出發:</span>
        <input type="text" class="input-text item-row-input input-start-name ${s.place_nickname ? 'text-success' : ''}" value="${escapeHTML(s.place_nickname || '')}" placeholder="出發地點名稱">
        <button class="btn btn-xs btn-search-start">搜尋</button>
        <button class="icon-preview-btn btn-icon-start" title="選擇圖示"><img src="icons/${s.place_icon || '750'}.png"></button>
      </div>

      <!-- 抵達點 -->
      <div class="item-row">
        <span class="item-row-label">抵達:</span>
        <input type="text" class="input-text item-row-input input-end-name ${e.place_nickname ? 'text-success' : ''}" value="${escapeHTML(e.place_nickname || '')}" placeholder="抵達地點名稱">
        <button class="btn btn-xs btn-search-end">搜尋</button>
        <button class="icon-preview-btn btn-icon-end" title="選擇圖示"><img src="icons/${e.place_icon || '750'}.png"></button>
      </div>

      <!-- 移動方式 -->
      <div class="item-row">
        <span class="item-row-label">方式:</span>
        <select class="select-box select-move-way" style="flex: 1;">
          <option value="大眾運輸" ${item.move_way === '大眾運輸' ? 'selected' : ''}>大眾運輸</option>
          <option value="開車" ${item.move_way === '開車' ? 'selected' : ''}>開車</option>
          <option value="騎腳踏車" ${item.move_way === '腳踏車' || item.move_way === '騎腳踏車' ? 'selected' : ''}>腳踏車</option>
          <option value="走路" ${item.move_way === '走路' ? 'selected' : ''}>走路</option>
          <option value="摩托車" ${item.move_way === '摩托車' ? 'selected' : ''}>摩托車</option>
        </select>
        <button class="btn btn-xs btn-primary btn-plan-route" title="在 Google Maps 開啟路線規劃">規劃</button>
      </div>

      <!-- 時間設定 -->
      <div class="item-row">
        <span class="item-row-label">開始:</span>
        <button class="time-btn btn-start-time">${formatTimeButtonText(s)}</button>
      </div>
      <div class="item-row">
        <span class="item-row-label">結束:</span>
        <button class="time-btn btn-end-time">${formatTimeButtonText(e)}</button>
      </div>

      <!-- 耗時與計算 -->
      <div class="item-row" style="justify-content: space-between;">
        <span style="font-size: 10px; color: var(--text-muted);">耗時: <strong class="time-delta-val" style="color: var(--text-main);">${item.time_delta}</strong> 分鐘</span>
        <button class="btn btn-xs btn-calc-time">計算</button>
      </div>

      <!-- 預算 -->
      <div class="item-row">
        <span class="item-row-label">預算:</span>
        <input type="text" class="input-text item-budget" style="flex: 1;" placeholder="金額" value="${escapeHTML(item.budget || '')}">
        <input type="text" class="input-text item-currency" style="width: 44px;" placeholder="幣別" value="${escapeHTML(item.currency || 'NTD')}">
      </div>

      <!-- 備忘 -->
      <textarea class="textarea-box item-note" placeholder="備註筆記...">${escapeHTML(item.note || '')}</textarea>

      <!-- 底部操作列 (拖曳把手與刪除) -->
      <div class="journey-item-footer">
        <div class="item-drag-handle" style="display: flex; align-items: center; gap: 4px; cursor: grab;" title="按住拖曳排序">
          <span class="state-dot ${dataCenter.active_item_id === item.id ? 'active' : ''}"></span>
          <span style="font-size: 10px; color: var(--text-dim);">移動</span>
        </div>
        <button class="btn btn-xs btn-danger btn-delete-item">刪除</button>
      </div>
    `;

    // 綁定輸入與操作事件
    card.querySelector('.input-start-name').addEventListener('change', (e) => {
      s.place_nickname = e.target.value;
      autoSaveDraft();
    });
    card.querySelector('.input-end-name').addEventListener('change', (ev) => {
      e.place_nickname = ev.target.value;
      autoSaveDraft();
    });

    card.querySelector('.btn-search-start').addEventListener('click', () => {
      searchInput.value = s.place_nickname || '';
      executeSearch(s.place_nickname);
    });
    card.querySelector('.btn-search-end').addEventListener('click', () => {
      searchInput.value = e.place_nickname || '';
      executeSearch(e.place_nickname);
    });

    card.querySelector('.btn-icon-start').addEventListener('click', () => {
      openIconPicker(s, () => {
        card.querySelector('.btn-icon-start img').src = `icons/${s.place_icon}.png`;
        mapCtrl.renderJourney(dataCenter.journey_days);
      });
    });
    card.querySelector('.btn-icon-end').addEventListener('click', () => {
      openIconPicker(e, () => {
        card.querySelector('.btn-icon-end img').src = `icons/${e.place_icon}.png`;
        mapCtrl.renderJourney(dataCenter.journey_days);
      });
    });

    card.querySelector('.select-move-way').addEventListener('change', (ev) => {
      item.move_way = ev.target.value;
      autoSaveDraft();
    });

    card.querySelector('.btn-plan-route').addEventListener('click', () => {
      if (s.place_nickname && e.place_nickname) {
        mapCtrl.openDirections(s.place_nickname, e.place_nickname, item.move_way);
      } else {
        alert('請先填寫出發點與抵達點名稱');
      }
    });

    card.querySelector('.btn-start-time').addEventListener('click', () => {
      openDateTimePicker(s, () => {
        card.querySelector('.btn-start-time').textContent = formatTimeButtonText(s);
        item.updateTimeDelta();
        card.querySelector('.time-delta-val').textContent = item.time_delta;
      });
    });

    card.querySelector('.btn-end-time').addEventListener('click', () => {
      openDateTimePicker(e, () => {
        card.querySelector('.btn-end-time').textContent = formatTimeButtonText(e);
        item.updateTimeDelta();
        card.querySelector('.time-delta-val').textContent = item.time_delta;
      });
    });

    card.querySelector('.btn-calc-time').addEventListener('click', () => {
      item.updateTimeDelta();
      card.querySelector('.time-delta-val').textContent = item.time_delta;
      autoSaveDraft();
    });

    card.querySelector('.item-budget').addEventListener('input', (ev) => {
      item.budget = ev.target.value;
      autoSaveDraft();
    });
    card.querySelector('.item-currency').addEventListener('input', (ev) => {
      item.currency = ev.target.value;
      autoSaveDraft();
    });
    card.querySelector('.item-note').addEventListener('input', (ev) => {
      item.note = ev.target.value;
      autoSaveDraft();
    });

    card.querySelector('.btn-delete-item').addEventListener('click', () => {
      day.items = day.items.filter(it => it !== item);
      if (dataCenter.active_item_id === item.id) {
        dataCenter.active_item_id = null;
        dataCenter.active_item_type = null;
      }
      renderJourneyDays();
      mapCtrl.renderJourney(dataCenter.journey_days);
      refreshAllDynamicButtons();
      autoSaveDraft();
    });
  }

  /**
   * 渲染「停留」項目卡片
   */
  function renderStayCardContent(card, item, day) {
    const s = item.placemodel_start;
    const e = item.placemodel_end;

    card.innerHTML = `
      <!-- 停留地點 -->
      <div class="item-row">
        <span class="item-row-label">停留:</span>
        <input type="text" class="input-text item-row-input input-stay-name ${s.place_nickname ? 'text-success' : ''}" value="${escapeHTML(s.place_nickname || '')}" placeholder="停留地點/餐廳名稱">
        <button class="btn btn-xs btn-search-stay">搜尋</button>
        <button class="icon-preview-btn btn-icon-stay" title="選擇圖示"><img src="icons/${s.place_icon || '750'}.png"></button>
      </div>

      <!-- 時間設定 -->
      <div class="item-row">
        <span class="item-row-label">開始:</span>
        <button class="time-btn btn-start-time">${formatTimeButtonText(s)}</button>
      </div>
      <div class="item-row">
        <span class="item-row-label">結束:</span>
        <button class="time-btn btn-end-time">${formatTimeButtonText(e)}</button>
      </div>

      <!-- 耗時與計算 -->
      <div class="item-row" style="justify-content: space-between;">
        <span style="font-size: 10px; color: var(--text-muted);">耗時: <strong class="time-delta-val" style="color: var(--text-main);">${item.time_delta}</strong> 分鐘</span>
        <button class="btn btn-xs btn-calc-time">計算</button>
      </div>

      <!-- 預算 -->
      <div class="item-row">
        <span class="item-row-label">預算:</span>
        <input type="text" class="input-text item-budget" style="flex: 1;" placeholder="金額" value="${escapeHTML(item.budget || '')}">
        <input type="text" class="input-text item-currency" style="width: 44px;" placeholder="幣別" value="${escapeHTML(item.currency || 'NTD')}">
      </div>

      <!-- 備忘 -->
      <textarea class="textarea-box item-note" placeholder="備註筆記...">${escapeHTML(item.note || '')}</textarea>

      <!-- 底部操作列 -->
      <div class="journey-item-footer">
        <div class="item-drag-handle" style="display: flex; align-items: center; gap: 4px; cursor: grab;" title="按住拖曳排序">
          <span class="state-dot ${dataCenter.active_item_id === item.id ? 'active' : ''}"></span>
          <span style="font-size: 10px; color: var(--text-dim);">停留</span>
        </div>
        <button class="btn btn-xs btn-danger btn-delete-item">刪除</button>
      </div>
    `;

    card.querySelector('.input-stay-name').addEventListener('change', (ev) => {
      s.place_nickname = ev.target.value;
      autoSaveDraft();
    });

    card.querySelector('.btn-search-stay').addEventListener('click', () => {
      searchInput.value = s.place_nickname || '';
      executeSearch(s.place_nickname);
    });

    card.querySelector('.btn-icon-stay').addEventListener('click', () => {
      openIconPicker(s, () => {
        card.querySelector('.btn-icon-stay img').src = `icons/${s.place_icon}.png`;
        mapCtrl.renderJourney(dataCenter.journey_days);
      });
    });

    card.querySelector('.btn-start-time').addEventListener('click', () => {
      openDateTimePicker(s, () => {
        card.querySelector('.btn-start-time').textContent = formatTimeButtonText(s);
        item.updateTimeDelta();
        card.querySelector('.time-delta-val').textContent = item.time_delta;
      });
    });

    card.querySelector('.btn-end-time').addEventListener('click', () => {
      openDateTimePicker(e, () => {
        card.querySelector('.btn-end-time').textContent = formatTimeButtonText(e);
        item.updateTimeDelta();
        card.querySelector('.time-delta-val').textContent = item.time_delta;
      });
    });

    card.querySelector('.btn-calc-time').addEventListener('click', () => {
      item.updateTimeDelta();
      card.querySelector('.time-delta-val').textContent = item.time_delta;
      autoSaveDraft();
    });

    card.querySelector('.item-budget').addEventListener('input', (ev) => {
      item.budget = ev.target.value;
      autoSaveDraft();
    });
    card.querySelector('.item-currency').addEventListener('input', (ev) => {
      item.currency = ev.target.value;
      autoSaveDraft();
    });
    card.querySelector('.item-note').addEventListener('input', (ev) => {
      item.note = ev.target.value;
      autoSaveDraft();
    });

    card.querySelector('.btn-delete-item').addEventListener('click', () => {
      day.items = day.items.filter(it => it !== item);
      if (dataCenter.active_item_id === item.id) {
        dataCenter.active_item_id = null;
        dataCenter.active_item_type = null;
      }
      renderJourneyDays();
      mapCtrl.renderJourney(dataCenter.journey_days);
      refreshAllDynamicButtons();
      autoSaveDraft();
    });
  }

  /**
   * 渲染「路徑」自由繪製項目卡片
   */
  function renderPathCardContent(card, item, day) {
    const s = item.placemodel_start;
    const e = item.placemodel_end;
    const colorHex = CJ_CONSTANTS.COLOR_DICT[item.color] || '#212121';

    card.innerHTML = `
      <!-- 路徑名稱與顏色 -->
      <div class="item-row">
        <span class="item-row-label">路徑:</span>
        <input type="text" class="input-text item-row-input input-path-name text-success" value="${escapeHTML(item.path_name || '')}" placeholder="路徑名稱 (例: 漫步散策)">
        <div class="color-preview-btn btn-color-picker" style="background-color: ${colorHex};" title="選擇路徑顏色"></div>
      </div>

      <!-- 繪製工具 -->
      <div class="item-row" style="gap: 3px;">
        <span class="item-row-label">工具:</span>
        <button class="btn btn-xs btn-primary btn-draw-start">繪製</button>
        <button class="btn btn-xs btn-draw-pause">暫停</button>
        <button class="btn btn-xs btn-draw-undo">返回</button>
        <button class="btn btn-xs btn-success btn-draw-finish">完成</button>
      </div>

      <!-- 距離與步行時間預估 -->
      <div style="font-size: 10px; color: var(--text-accent); text-align: center; margin: 2px 0;">
        總長: <strong class="path-distance-val">${item.distance.toFixed(2)}</strong> km / 步行約 <strong class="path-walking-val">${item.walking_time}</strong> 分
      </div>

      <!-- 時間設定 -->
      <div class="item-row">
        <span class="item-row-label">開始:</span>
        <button class="time-btn btn-start-time">${formatTimeButtonText(s)}</button>
      </div>
      <div class="item-row">
        <span class="item-row-label">結束:</span>
        <button class="time-btn btn-end-time">${formatTimeButtonText(e)}</button>
      </div>

      <!-- 耗時與計算 -->
      <div class="item-row" style="justify-content: space-between;">
        <span style="font-size: 10px; color: var(--text-muted);">耗時: <strong class="time-delta-val" style="color: var(--text-main);">${item.time_delta}</strong> 分鐘</span>
        <button class="btn btn-xs btn-calc-time">計算</button>
      </div>

      <!-- 預算 -->
      <div class="item-row">
        <span class="item-row-label">預算:</span>
        <input type="text" class="input-text item-budget" style="flex: 1;" placeholder="金額" value="${escapeHTML(item.budget || '')}">
        <input type="text" class="input-text item-currency" style="width: 44px;" placeholder="幣別" value="${escapeHTML(item.currency || 'NTD')}">
      </div>

      <!-- 備忘 -->
      <textarea class="textarea-box item-note" placeholder="備註筆記...">${escapeHTML(item.note || '')}</textarea>

      <!-- 底部操作列 -->
      <div class="journey-item-footer">
        <div class="item-drag-handle" style="display: flex; align-items: center; gap: 4px; cursor: grab;" title="按住拖曳排序">
          <span class="state-dot ${dataCenter.active_item_id === item.id ? 'active' : ''}"></span>
          <span style="font-size: 10px; color: var(--text-dim);">路徑</span>
        </div>
        <button class="btn btn-xs btn-danger btn-delete-item">刪除</button>
      </div>
    `;

    card.querySelector('.input-path-name').addEventListener('change', (ev) => {
      item.path_name = ev.target.value;
      autoSaveDraft();
    });

    card.querySelector('.btn-color-picker').addEventListener('click', () => {
      openColorPicker(item, (newColor) => {
        card.querySelector('.btn-color-picker').style.backgroundColor = CJ_CONSTANTS.COLOR_DICT[newColor];
        mapCtrl.renderJourney(dataCenter.journey_days);
      });
    });

    // 繪製工具綁定
    const distEl = card.querySelector('.path-distance-val');
    const walkEl = card.querySelector('.path-walking-val');

    card.querySelector('.btn-draw-start').addEventListener('click', () => {
      mapCtrl.startDrawingPath(item, (updated) => {
        updated.updateDistance(dataCenter.default_walk_velocity);
        distEl.textContent = updated.distance.toFixed(2);
        walkEl.textContent = updated.walking_time;
      });
    });

    card.querySelector('.btn-draw-pause').addEventListener('click', () => {
      mapCtrl.pauseDrawingPath();
    });

    card.querySelector('.btn-draw-undo').addEventListener('click', () => {
      mapCtrl.undoDrawingPoint();
    });

    card.querySelector('.btn-draw-finish').addEventListener('click', () => {
      mapCtrl.finishDrawingPath();
      item.updateDistance(dataCenter.default_walk_velocity);
      distEl.textContent = item.distance.toFixed(2);
      walkEl.textContent = item.walking_time;
      mapCtrl.renderJourney(dataCenter.journey_days);
      autoSaveDraft();
    });

    card.querySelector('.btn-start-time').addEventListener('click', () => {
      openDateTimePicker(s, () => {
        card.querySelector('.btn-start-time').textContent = formatTimeButtonText(s);
        item.updateTimeDelta();
        card.querySelector('.time-delta-val').textContent = item.time_delta;
      });
    });

    card.querySelector('.btn-end-time').addEventListener('click', () => {
      openDateTimePicker(e, () => {
        card.querySelector('.btn-end-time').textContent = formatTimeButtonText(e);
        item.updateTimeDelta();
        card.querySelector('.time-delta-val').textContent = item.time_delta;
      });
    });

    card.querySelector('.btn-calc-time').addEventListener('click', () => {
      item.updateTimeDelta();
      card.querySelector('.time-delta-val').textContent = item.time_delta;
      autoSaveDraft();
    });

    card.querySelector('.item-budget').addEventListener('input', (ev) => {
      item.budget = ev.target.value;
      autoSaveDraft();
    });
    card.querySelector('.item-currency').addEventListener('input', (ev) => {
      item.currency = ev.target.value;
      autoSaveDraft();
    });
    card.querySelector('.item-note').addEventListener('input', (ev) => {
      item.note = ev.target.value;
      autoSaveDraft();
    });

    card.querySelector('.btn-delete-item').addEventListener('click', () => {
      day.items = day.items.filter(it => it !== item);
      if (dataCenter.active_item_id === item.id) {
        dataCenter.active_item_id = null;
        dataCenter.active_item_type = null;
      }
      renderJourneyDays();
      mapCtrl.renderJourney(dataCenter.journey_days);
      refreshAllDynamicButtons();
      autoSaveDraft();
    });
  }

  function formatTimeButtonText(placeModel) {
    if (!placeModel || !placeModel.date) return '尚未設定時間';
    const weekday = CJUtils.getWeekdayZH(placeModel.date);
    const timeStr = `${String(placeModel.hour).padStart(2, '0')}:${String(placeModel.minute).padStart(2, '0')}`;
    return `${placeModel.date} (${weekday})  ${timeStr}  UTC:${placeModel.timezone}`;
  }

  // ==========================================
  // 8. 彈窗實作：圖示挑選器 (Icon Picker)
  // ==========================================

  const colorBar = document.getElementById('icon-picker-color-bar');
  const iconGrid = document.getElementById('icon-picker-grid');
  const iconPreview = document.getElementById('icon-picker-preview');
  let onIconConfirmedCallback = null;

  // 產生 7 色切換按鈕
  function initIconPickerUI() {
    colorBar.innerHTML = '';
    for (let c = 0; c < 7; c++) {
      const btn = document.createElement('div');
      btn.className = `color-circle ${c === 0 ? 'selected' : ''}`;
      btn.style.backgroundColor = CJ_CONSTANTS.COLOR_DICT[String(c)];
      btn.dataset.color = String(c);
      btn.addEventListener('click', () => {
        document.querySelectorAll('#icon-picker-color-bar .color-circle').forEach(el => el.classList.remove('selected'));
        btn.classList.add('selected');
        tempIconSelection.color = String(c);
        renderIconGrid(tempIconSelection.color);
        updateIconPreview();
      });
      colorBar.appendChild(btn);
    }
  }

  // 產生 8x8 = 64 款圖示網格
  function renderIconGrid(colorCode) {
    iconGrid.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const iconCode = `${r}${c}${colorCode}`;
        const item = document.createElement('div');
        item.className = `icon-grid-item ${tempIconSelection.row === r && tempIconSelection.col === c ? 'selected' : ''}`;
        item.innerHTML = `<img src="icons/${iconCode}.png" alt="${iconCode}">`;

        item.addEventListener('click', () => {
          document.querySelectorAll('.icon-grid-item').forEach(el => el.classList.remove('selected'));
          item.classList.add('selected');
          tempIconSelection.row = r;
          tempIconSelection.col = c;
          updateIconPreview();
        });

        iconGrid.appendChild(item);
      }
    }
  }

  function updateIconPreview() {
    const fullCode = `${tempIconSelection.row}${tempIconSelection.col}${tempIconSelection.color}`;
    iconPreview.innerHTML = `<img src="icons/${fullCode}.png" style="width:24px; height:24px;">`;
  }

  function openIconPicker(targetPlaceModel, onConfirm) {
    currentEditingPlace = targetPlaceModel;
    onIconConfirmedCallback = onConfirm;

    const currentCode = targetPlaceModel.place_icon || '750';
    if (currentCode.length === 3) {
      tempIconSelection.row = parseInt(currentCode[0], 10);
      tempIconSelection.col = parseInt(currentCode[1], 10);
      tempIconSelection.color = currentCode[2];
    }

    renderIconGrid(tempIconSelection.color);
    updateIconPreview();
    openModal(modalIconPicker);
  }

  document.getElementById('btn-confirm-icon').addEventListener('click', () => {
    if (currentEditingPlace) {
      const fullCode = `${tempIconSelection.row}${tempIconSelection.col}${tempIconSelection.color}`;
      currentEditingPlace.place_icon = fullCode;
      if (typeof onIconConfirmedCallback === 'function') {
        onIconConfirmedCallback(fullCode);
      }
      autoSaveDraft();
    }
    closeModal(modalIconPicker);
  });

  // ==========================================
  // 9. 彈窗實作：顏色挑選器 (Color Picker for Paths)
  // ==========================================

  let onColorConfirmedCallback = null;
  function initColorPickerUI() {
    const grid = document.getElementById('color-picker-grid');
    grid.innerHTML = '';
    for (let c = 0; c < 7; c++) {
      const circle = document.createElement('div');
      circle.className = `color-circle ${c === 6 ? 'selected' : ''}`;
      circle.style.backgroundColor = CJ_CONSTANTS.COLOR_DICT[String(c)];
      circle.dataset.color = String(c);
      circle.addEventListener('click', () => {
        document.querySelectorAll('#color-picker-grid .color-circle').forEach(el => el.classList.remove('selected'));
        circle.classList.add('selected');
        tempColorSelection = String(c);
      });
      grid.appendChild(circle);
    }
  }

  function openColorPicker(pathModel, onConfirm) {
    currentEditingPath = pathModel;
    onColorConfirmedCallback = onConfirm;
    tempColorSelection = pathModel.color || '6';

    document.querySelectorAll('#color-picker-grid .color-circle').forEach(el => {
      el.classList.toggle('selected', el.dataset.color === tempColorSelection);
    });

    openModal(modalColorPicker);
  }

  document.getElementById('btn-confirm-color').addEventListener('click', () => {
    if (currentEditingPath) {
      currentEditingPath.color = tempColorSelection;
      if (typeof onColorConfirmedCallback === 'function') {
        onColorConfirmedCallback(tempColorSelection);
      }
      autoSaveDraft();
    }
    closeModal(modalColorPicker);
  });

  // ==========================================
  // 10. 彈窗實作：行程時間與日期設定 (DateTime Picker)
  // ==========================================

  let onDateTimeConfirmedCallback = null;
  const dtDateInput = document.getElementById('dt-picker-date');
  const dtHourInput = document.getElementById('dt-picker-hour');
  const dtMinuteInput = document.getElementById('dt-picker-minute');
  const dtTimezoneSelect = document.getElementById('dt-picker-timezone');

  function openDateTimePicker(placeModel, onConfirm) {
    currentEditingPlace = placeModel;
    currentEditingDay = null;
    onDateTimeConfirmedCallback = onConfirm;

    dtDateInput.value = placeModel.date || CJUtils.formatDate(new Date());
    dtHourInput.value = placeModel.hour !== undefined ? placeModel.hour : 12;
    dtMinuteInput.value = placeModel.minute !== undefined ? placeModel.minute : 30;
    dtTimezoneSelect.value = placeModel.timezone || dataCenter.default_timezone;

    openModal(modalDatetimePicker);
  }

  function openDayDatePicker(day) {
    currentEditingDay = day;
    currentEditingPlace = null;
    onDateTimeConfirmedCallback = null;

    dtDateInput.value = day.date;
    dtHourInput.value = 0;
    dtMinuteInput.value = 0;
    dtTimezoneSelect.value = dataCenter.default_timezone;

    openModal(modalDatetimePicker);
  }

  document.getElementById('btn-confirm-datetime').addEventListener('click', () => {
    if (currentEditingPlace) {
      currentEditingPlace.date = dtDateInput.value;
      currentEditingPlace.hour = parseInt(dtHourInput.value, 10) || 0;
      currentEditingPlace.minute = parseInt(dtMinuteInput.value, 10) || 0;
      currentEditingPlace.timezone = dtTimezoneSelect.value;

      if (typeof onDateTimeConfirmedCallback === 'function') {
        onDateTimeConfirmedCallback(currentEditingPlace);
      }
      autoSaveDraft();
    } else if (currentEditingDay) {
      currentEditingDay.date = dtDateInput.value;
      renderJourneyDays();
      autoSaveDraft();
    }
    closeModal(modalDatetimePicker);
  });

  // ==========================================
  // 11. 彈窗實作：設定視窗 (Settings)
  // ==========================================

  btnOpenSettings.addEventListener('click', () => {
    document.getElementById('setting-walk-velocity').value = dataCenter.default_walk_velocity;
    document.getElementById('setting-currency').value = dataCenter.default_currency;
    document.getElementById('setting-timezone').value = dataCenter.default_timezone;
    openModal(modalSettings);
  });

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    const v = parseInt(document.getElementById('setting-walk-velocity').value, 10);
    if (!isNaN(v) && v >= 3 && v <= 120) {
      dataCenter.default_walk_velocity = v;
      // 重新計算所有已存在路徑的步行時間
      dataCenter.journey_days.forEach(d => {
        d.items.forEach(it => {
          if (it.type === 'path') it.updateDistance(v);
        });
      });
      renderJourneyDays();
    }
    dataCenter.default_currency = document.getElementById('setting-currency').value.trim() || 'NTD';
    dataCenter.default_timezone = document.getElementById('setting-timezone').value;

    dataCenter.saveSettings();
    closeModal(modalSettings);
    alert('設定已成功儲存！');
  });

  // 說明視窗
  btnOpenHelp.addEventListener('click', () => {
    openModal(modalHelp);
  });

  // ==========================================
  // 12. 檔案存讀 (JSON) 與 CSV 報表製作
  // ==========================================

  // 旅程名稱更動
  inputJourneyName.addEventListener('change', (e) => {
    dataCenter.journey_name = e.target.value.trim();
    document.title = dataCenter.journey_name ? `${dataCenter.journey_name} - itinerary` : 'itinerary';
    // 若修改了旅程名稱且與先前綁定的檔案不同，重設 handle 但保留 lastFileHandle 以記憶目錄
    const newFileName = (dataCenter.journey_name || '我的旅程') + '.json';
    if (currentFileHandle && currentFileHandle.name !== newFileName) {
      lastFileHandle = currentFileHandle;
      currentFileHandle = null;
    }
    autoSaveDraft();
  });

  // 檔案把手暫存（支援 File System Access API 原檔覆寫與目錄記憶）
  let currentFileHandle = null;
  let lastFileHandle = null;

  function showToastNotification(msg) {
    let toast = document.getElementById('cj-toast-msg');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'cj-toast-msg';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(24, 24, 34, 0.95);
        color: #fff;
        padding: 10px 20px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        font-size: 13px;
        font-weight: 500;
        z-index: 999999;
        pointer-events: none;
        transition: opacity 0.25s, transform 0.25s;
        white-space: pre-line;
        text-align: center;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(8px)';
    }, 2800);
  }

  // 1. 範圍顯示全部
  btnShowJourneyRange.addEventListener('click', () => {
    mapCtrl.fitAllJourneyAndFavorites(dataCenter);
  });

  // 2. 新的旅程
  btnNewJourney.addEventListener('click', () => {
    if (confirm('確定要清空並建立全新旅程嗎？請確認當前行程已存檔。')) {
      dataCenter.newJourney();
      currentFileHandle = null;
      inputJourneyName.value = '';
      document.title = 'itinerary';
      renderSearchResults();
      renderFavoriteItems();
      renderJourneyDays();
      mapCtrl.renderSearchMarkers([]);
      mapCtrl.renderFavoriteMarkers([]);
      mapCtrl.renderJourney([]);
      localStorage.removeItem('cjmap_draft');
    }
  });

  // 3. 儲存旅程 (優先使用 File System Access API 原檔直接覆蓋，預設桌面或上次位置)
  btnSaveJourney.addEventListener('click', async () => {
    const jsonObj = dataCenter.toJSON();
    const jsonStr = JSON.stringify(jsonObj, null, 2);
    const fileName = (dataCenter.journey_name || '我的旅程') + '.json';

    // 若瀏覽器環境支援 File System Access API
    if ('showSaveFilePicker' in window) {
      try {
        if (!currentFileHandle) {
          // 預設起始位置為桌面，若先前有開啟或儲存過則鎖定在該目錄
          currentFileHandle = await window.showSaveFilePicker({
            suggestedName: fileName,
            startIn: lastFileHandle || 'desktop',
            types: [{
              description: 'itinerary 旅程檔案 (*.json)',
              accept: { 'application/json': ['.json'] }
            }]
          });
        }

        // 直接寫入覆蓋原檔
        const writable = await currentFileHandle.createWritable();
        await writable.write(jsonStr);
        await writable.close();

        lastFileHandle = currentFileHandle;
        const savedName = currentFileHandle.name || fileName;
        showToastNotification(`💾 已直接覆蓋儲存：「${savedName}」`);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // 使用者按下取消
        console.warn('File System Access API 受限，切換為標準下載', err);
        currentFileHandle = null;
      }
    }

    // 降級方案：標準瀏覽器下載
    CJUtils.downloadFile(fileName, jsonStr, 'application/json;charset=utf-8');
    showToastNotification(`💾 已發送檔案下載：「${fileName}」`);
  });

  // 4. 讀取旅程 (載入 JSON，預設桌面或上次位置，並記住檔案把手以便後續直接覆寫)
  btnLoadJourney.addEventListener('click', async () => {
    // 優先嘗試使用 File System Access API 取得可覆寫的 Handle
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await window.showOpenFilePicker({
          startIn: currentFileHandle || lastFileHandle || 'desktop',
          types: [{
            description: 'itinerary 旅程檔案 (*.json)',
            accept: { 'application/json': ['.json'] }
          }],
          multiple: false
        });

        if (handle) {
          const file = await handle.getFile();
          const text = await file.text();
          const data = JSON.parse(text);

          dataCenter.fromJSON(data);
          currentFileHandle = handle; // 記住檔案 handle，後續點儲存直接覆寫！
          lastFileHandle = handle;

          inputJourneyName.value = dataCenter.journey_name || '';
          document.title = dataCenter.journey_name ? `${dataCenter.journey_name} - itinerary` : 'itinerary';

          renderSearchResults();
          renderFavoriteItems();
          renderJourneyDays();

          mapCtrl.renderFavoriteMarkers(dataCenter.favorite_places, dataCenter.show_favorite);
          mapCtrl.renderJourney(dataCenter.journey_days);
          mapCtrl.fitAllJourneyAndFavorites(dataCenter);

          autoSaveDraft();
          showToastNotification(`📂 成功載入：「${handle.name}」\n後續點擊「儲存旅程」將直接覆蓋原檔！`);
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn('showOpenFilePicker 受限，使用標準檔案選擇器', err);
      }
    }

    // 降級方案：使用常規檔案選擇器
    fileInputLoad.click();
  });

  fileInputLoad.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        dataCenter.fromJSON(data);
        currentFileHandle = null;

        inputJourneyName.value = dataCenter.journey_name || '';
        document.title = dataCenter.journey_name ? `${dataCenter.journey_name} - itinerary` : 'itinerary';

        renderSearchResults();
        renderFavoriteItems();
        renderJourneyDays();

        mapCtrl.renderFavoriteMarkers(dataCenter.favorite_places, dataCenter.show_favorite);
        mapCtrl.renderJourney(dataCenter.journey_days);
        mapCtrl.fitAllJourneyAndFavorites(dataCenter);

        autoSaveDraft();
        showToastNotification(`📂 成功載入旅程：「${dataCenter.journey_name || file.name}」！`);
      } catch (err) {
        console.error(err);
        alert('讀取失敗：不是有效的 CJ Map 旅程 JSON 格式檔案。');
      }
    };
    reader.readAsText(file);
    fileInputLoad.value = ''; // 重設以允許再次選取同檔名
  });

  // 5. 製作報表 (一鍵下載 3 份 CSV)
  btnMakeReport.addEventListener('click', () => {
    if (dataCenter.journey_days.length === 0 && dataCenter.favorite_places.length === 0) {
      alert('目前尚無旅程或口袋名單可製作報表！');
      return;
    }

    const baseName = dataCenter.journey_name || 'CJMap旅程';

    // 1. Google 我的地圖 - 旅程清單 CSV (WKT)
    const journeyMapCSV = dataCenter.generateJourneyMapCSV();
    CJUtils.downloadFile(`${baseName}_旅程清單.csv`, journeyMapCSV, 'text/csv;charset=utf-8');

    // 2. Google 我的地圖 - 口袋清單 CSV (WKT)
    setTimeout(() => {
      const favMapCSV = dataCenter.generateFavoriteMapCSV();
      CJUtils.downloadFile(`${baseName}_口袋清單.csv`, favMapCSV, 'text/csv;charset=utf-8');
    }, 250);

    // 3. 預算表 CSV
    setTimeout(() => {
      const budgetCSV = dataCenter.generateBudgetCSV();
      CJUtils.downloadFile(`${baseName}_預算表.csv`, budgetCSV, 'text/csv;charset=utf-8');
    }, 500);
  });

  // ==========================================
  // 13. 右鍵選單反查地址
  // ==========================================

  const btnContextSearch = document.getElementById('btn-context-search');
  if (btnContextSearch) {
    btnContextSearch.addEventListener('click', async () => {
      if (mapCtrl.contextLatLng) {
        mapCtrl.hideContextMenu();
        const info = await mapCtrl.reverseGeocode(mapCtrl.contextLatLng.lat, mapCtrl.contextLatLng.lng);
        const place = new PlaceModel({
          place_name: info.name,
          place_nickname: info.name,
          place_address: info.address,
          place_lat: info.lat,
          place_lng: info.lng,
          place_types: '經緯度位置',
          place_icon: CJ_CONSTANTS.DEFAULT_ICONS.SEARCH
        });

        dataCenter.search_places = [place];
        renderSearchResults();
        mapCtrl.renderSearchMarkers(dataCenter.search_places);
      }
    });
  }

  // ==========================================
  // 14. 自動儲存草稿 (localStorage Auto-Save)
  // ==========================================

  function autoSaveDraft() {
    try {
      const hasItems = dataCenter.journey_days.some(d => d.items && d.items.length > 0);
      const hasFavorites = dataCenter.favorite_places && dataCenter.favorite_places.length > 0;
      if (hasItems || hasFavorites) {
        const draft = dataCenter.toJSON();
        localStorage.setItem('cjmap_draft', JSON.stringify(draft));
      } else {
        localStorage.removeItem('cjmap_draft');
      }
    } catch (e) {
      // 靜默處理
    }
  }

  function loadDraft() {
    try {
      const saved = localStorage.getItem('cjmap_draft');
      if (saved) {
        const data = JSON.parse(saved);
        const hasItems = data && data.journey_daily_frames && data.journey_daily_frames.some(f => f.items && f.items.length > 0);
        const hasFavorites = data && data.favorite_models && data.favorite_models.length > 0;
        if (hasItems || hasFavorites) {
          dataCenter.fromJSON(data);
          inputJourneyName.value = dataCenter.journey_name || '';
          renderFavoriteItems();
          renderJourneyDays();
          mapCtrl.renderFavoriteMarkers(dataCenter.favorite_places, dataCenter.show_favorite);
          mapCtrl.renderJourney(dataCenter.journey_days);
          mapCtrl.fitAllJourneyAndFavorites(dataCenter);
        } else {
          localStorage.removeItem('cjmap_draft');
        }
      }
    } catch (e) {
      console.warn('載入草稿失敗', e);
    }
  }

  // 輔助防 XSS
  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ==========================================
  // 15. 初始化啟動流程
  // ==========================================

  initIconPickerUI();
  initColorPickerUI();

  // 啟動載入：若先前有儲存過旅程或口袋名單才載入，否則保持乾淨初始狀態
  loadDraft();
  renderJourneyDays();

});
