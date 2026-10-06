/**
 * CJ Map - 資料模型與核心狀態管理 (models.js)
 * 完全對應原 Python 專案之 DataCenter、PlaceModel、JourneyMoveModel、JourneyStayModel、JourneyPathModel
 * 提供完整 JSON 儲存/讀取序列化，以及 3 份 CSV 報表匯出功能
 */

// ==========================================
// 1. 常數與工具字典
// ==========================================

const CJ_CONSTANTS = {
  TIMEZONE_DICT: {
    '−12': -12, '−11': -11, '−10': -10, '−09': -9, '−08': -8, '−07': -7,
    '−06': -6, '−05': -5, '−04': -4, '−03': -3, '−02': -2, '−01': -1,
    '+00': 0, '+01': 1, '+02': 2, '+03': 3, '+04': 4, '+05': 5,
    '+06': 6, '+07': 7, '+08': 8, '+09': 9, '+10': 10, '+11': 11,
    '+12': 12
  },

  WEEKDAY_ZH: ['日', '一', '二', '三', '四', '五', '六'],
  WEEKDAY_EN: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],

  COLOR_DICT: {
    '0': '#d32f2f', // 紅色 (red3)
    '1': '#f57c00', // 橙色 (darkorange3)
    '2': '#2e7d32', // 綠色 (darkgreen)
    '3': '#1976d2', // 藍色 (blue3)
    '4': '#4a148c', // 靛藍 (indigo)
    '5': '#8e24aa', // 紫色 (mediumorchid3)
    '6': '#212121'  // 黑色 (black)
  },

  COLOR_NAMES: {
    '0': '紅色', '1': '橙色', '2': '綠色', '3': '藍色',
    '4': '靛青', '5': '紫色', '6': '黑色'
  },

  MOVE_WAY_MAP: {
    '開車': 'driving',
    '腳踏車': 'bicycling',
    '走路': 'walking',
    '摩托車': 'two-wheeler',
    '大眾運輸': 'transit'
  },

  DEFAULT_ICONS: {
    SEARCH: '770',
    FAVORITE: '760',
    PLACE: '750',
    EMPTY: '999'
  }
};

// ==========================================
// 2. 幾何運算與時間工具函數
// ==========================================

const CJUtils = {
  /**
   * 生成唯一 ID
   */
  uid() {
    return 'id_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
  },

  /**
   * 格式化日期為 YYYY-MM-DD
   */
  formatDate(dateObj) {
    if (!dateObj) return '';
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  /**
   * 獲取日期的中文星期表示 (例: "一")
   */
  getWeekdayZH(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return CJ_CONSTANTS.WEEKDAY_ZH[d.getDay()];
  },

  /**
   * 計算兩經緯度點間的大圓距離 (Haversine 演算法，單位：公里)
   */
  haversine(lat1, lon1, lat2, lon2) {
    const toRad = deg => (deg * Math.PI) / 180;
    const R = 6371; // 地球半徑 (km)
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  /**
   * 計算座標陣列的總長度 (單位：公里)
   * coords 格式: [[lat, lng], [lat, lng], ...]
   */
  calculateTotalDistance(coords) {
    if (!Array.isArray(coords) || coords.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];
      if (p1 && p2 && p1.length >= 2 && p2.length >= 2) {
        total += this.haversine(p1[0], p1[1], p2[0], p2[1]);
      }
    }
    return total;
  },

  /**
   * 依據時區計算時間差 (分鐘)
   */
  calculateTimeDelta(startDateStr, startHour, startMinute, startTimezone, endDateStr, endHour, endMinute, endTimezone) {
    try {
      const startParts = startDateStr.split('-').map(Number);
      const endParts = endDateStr.split('-').map(Number);
      const tzStartOffset = CJ_CONSTANTS.TIMEZONE_DICT[startTimezone] || 0;
      const tzEndOffset = CJ_CONSTANTS.TIMEZONE_DICT[endTimezone] || 0;

      // 換算為 UTC 時間戳 (毫秒)
      const startUtcMs = Date.UTC(startParts[0], startParts[1] - 1, startParts[2], Number(startHour) - tzStartOffset, Number(startMinute), 0);
      const endUtcMs = Date.UTC(endParts[0], endParts[1] - 1, endParts[2], Number(endHour) - tzEndOffset, Number(endMinute), 0);

      const diffMinutes = Math.floor((endUtcMs - startUtcMs) / (1000 * 60));
      return isNaN(diffMinutes) ? 0 : diffMinutes;
    } catch (e) {
      return 0;
    }
  },

  /**
   * 觸發瀏覽器下載檔案
   */
  downloadFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};

// ==========================================
// 3. 資料模型定義
// ==========================================

/**
 * 地點模型 (PlaceModel)
 */
class PlaceModel {
  constructor(options = {}) {
    this.id = options.id || CJUtils.uid();
    this.place_name = options.place_name || '';
    this.place_nickname = options.place_nickname || options.place_name || '';
    this.place_lat = options.place_lat !== undefined ? Number(options.place_lat) : null;
    this.place_lng = options.place_lng !== undefined ? Number(options.place_lng) : null;
    this.place_address = options.place_address || '';
    this.place_types = options.place_types || '';
    this.place_opening_hours_str = options.place_opening_hours_str || '';
    this.place_id = options.place_id || '';
    this.place_note = options.place_note || '';
    this.place_icon = options.place_icon || CJ_CONSTANTS.DEFAULT_ICONS.PLACE;

    // 時間相關
    this.date = options.date || CJUtils.formatDate(new Date());
    this.hour = options.hour !== undefined ? Number(options.hour) : 12;
    this.minute = options.minute !== undefined ? Number(options.minute) : 30;
    this.timezone = options.timezone || '+08';
  }

  clone() {
    return new PlaceModel({
      place_name: this.place_name,
      place_nickname: this.place_nickname,
      place_lat: this.place_lat,
      place_lng: this.place_lng,
      place_address: this.place_address,
      place_types: this.place_types,
      place_opening_hours_str: this.place_opening_hours_str,
      place_id: this.place_id,
      place_note: this.place_note,
      place_icon: this.place_icon,
      date: this.date,
      hour: this.hour,
      minute: this.minute,
      timezone: this.timezone
    });
  }
}

/**
 * 移動項目模型 (JourneyMoveModel)
 */
class JourneyMoveModel {
  constructor(startPlace = null, endPlace = null, options = {}) {
    this.id = options.id || CJUtils.uid();
    this.type = 'move';
    this.placemodel_start = startPlace || new PlaceModel();
    this.placemodel_end = endPlace || new PlaceModel();

    this.move_way = options.move_way || '大眾運輸';
    this.budget = options.budget || '';
    this.currency = options.currency || 'NTD';
    this.note = options.note || '';
    this.time_delta = options.time_delta !== undefined ? options.time_delta : 0;

    this.updateTimeDelta();
  }

  updateTimeDelta() {
    const s = this.placemodel_start;
    const e = this.placemodel_end;
    this.time_delta = CJUtils.calculateTimeDelta(
      s.date, s.hour, s.minute, s.timezone,
      e.date, e.hour, e.minute, e.timezone
    );
    return this.time_delta;
  }
}

/**
 * 停留項目模型 (JourneyStayModel)
 */
class JourneyStayModel {
  constructor(startPlace = null, endPlace = null, options = {}) {
    this.id = options.id || CJUtils.uid();
    this.type = 'stay';
    this.placemodel_start = startPlace || new PlaceModel();
    this.placemodel_end = endPlace || new PlaceModel();

    this.budget = options.budget || '';
    this.currency = options.currency || 'NTD';
    this.note = options.note || '';
    this.time_delta = options.time_delta !== undefined ? options.time_delta : 0;

    this.updateTimeDelta();
  }

  updateTimeDelta() {
    const s = this.placemodel_start;
    const e = this.placemodel_end;
    this.time_delta = CJUtils.calculateTimeDelta(
      s.date, s.hour, s.minute, s.timezone,
      e.date, e.hour, e.minute, e.timezone
    );
    return this.time_delta;
  }
}

/**
 * 路徑項目模型 (JourneyPathModel)
 */
class JourneyPathModel {
  constructor(startPlace = null, endPlace = null, options = {}) {
    this.id = options.id || CJUtils.uid();
    this.type = 'path';
    this.placemodel_start = startPlace || new PlaceModel();
    this.placemodel_end = endPlace || new PlaceModel();

    this.path_name = options.path_name || '';
    this.path_list = options.path_list || []; // [[lat, lng], [lat, lng], ...]
    this.color = options.color || '6'; // 預設黑色 '6'
    this.budget = options.budget || '';
    this.currency = options.currency || 'NTD';
    this.note = options.note || '';
    this.distance = options.distance || 0; // 公里
    this.walking_time = options.walking_time || 0; // 步行分鐘
    this.time_delta = options.time_delta !== undefined ? options.time_delta : 0;

    this.updateDistance();
    this.updateTimeDelta();
  }

  updateDistance(walkVelocity = 20) {
    this.distance = CJUtils.calculateTotalDistance(this.path_list);
    this.walking_time = Math.ceil(this.distance * Number(walkVelocity));
  }

  updateTimeDelta() {
    const s = this.placemodel_start;
    const e = this.placemodel_end;
    this.time_delta = CJUtils.calculateTimeDelta(
      s.date, s.hour, s.minute, s.timezone,
      e.date, e.hour, e.minute, e.timezone
    );
    return this.time_delta;
  }
}

/**
 * 每日行程模型 (JourneyDay)
 */
class JourneyDay {
  constructor(options = {}) {
    this.id = options.id || CJUtils.uid();
    this.date = options.date || CJUtils.formatDate(new Date());
    this.show_on_map = options.show_on_map !== undefined ? options.show_on_map : true;
    this.items = options.items || []; // Array of JourneyMoveModel | JourneyStayModel | JourneyPathModel
  }
}

// ==========================================
// 4. 全域狀態管理 (DataCenter)
// ==========================================

class DataCenter {
  constructor() {
    // 預設設定
    this.default_api_key = '';
    this.default_walk_velocity = 20; // 分鐘/公里
    this.default_currency = 'NTD';
    this.default_timezone = '+08';
    this.default_is_free = true;

    // 當前旅程名稱
    this.journey_name = '';

    // 口袋名單
    this.favorite_places = []; // Array of PlaceModel
    this.show_favorite = true;

    // 搜尋結果
    this.search_places = []; // Array of PlaceModel

    // 每日行程清單
    this.journey_days = []; // Array of JourneyDay

    // 活躍狀態指標
    this.active_day_id = null;
    this.active_item_id = null;
    this.active_item_type = null; // 'move' | 'stay' | 'path' | null

    this.loadSettings();
  }

  /**
   * 載入本機設定
   */
  loadSettings() {
    try {
      const saved = localStorage.getItem('cjmap_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.default_walk_velocity !== undefined) this.default_walk_velocity = Number(parsed.default_walk_velocity);
        if (parsed.default_currency) this.default_currency = parsed.default_currency;
        if (parsed.default_timezone) this.default_timezone = parsed.default_timezone;
        if (parsed.default_is_free !== undefined) this.default_is_free = parsed.default_is_free;
      }
    } catch (e) {
      console.warn('載入設定失敗，採用預設值', e);
    }
  }

  /**
   * 儲存設定至 localStorage
   */
  saveSettings() {
    try {
      const settings = {
        default_walk_velocity: this.default_walk_velocity,
        default_currency: this.default_currency,
        default_timezone: this.default_timezone,
        default_is_free: this.default_is_free
      };
      localStorage.setItem('cjmap_settings', JSON.stringify(settings));
    } catch (e) {
      console.warn('儲存設定失敗', e);
    }
  }

  /**
   * 重設為新的旅程
   */
  newJourney() {
    this.journey_name = '';
    this.favorite_places = [];
    this.search_places = [];
    this.journey_days = [];
    this.active_day_id = null;
    this.active_item_id = null;
    this.active_item_type = null;
  }

  /**
   * 新增一日
   */
  addNewDay(dateStr = null) {
    let newDate;
    if (dateStr) {
      newDate = dateStr;
    } else if (this.journey_days.length > 0) {
      const lastDate = new Date(this.journey_days[this.journey_days.length - 1].date);
      lastDate.setDate(lastDate.getDate() + 1);
      newDate = CJUtils.formatDate(lastDate);
    } else {
      newDate = CJUtils.formatDate(new Date());
    }

    const day = new JourneyDay({ date: newDate });
    this.journey_days.push(day);
    this.active_day_id = day.id;
    this.active_item_id = null;
    this.active_item_type = null;
    return day;
  }

  /**
   * 獲取當前活躍的一日
   */
  getActiveDay() {
    if (!this.active_day_id && this.journey_days.length > 0) {
      this.active_day_id = this.journey_days[0].id;
    }
    return this.journey_days.find(d => d.id === this.active_day_id) || null;
  }

  /**
   * 獲取當前活躍的行程項目
   */
  getActiveItem() {
    if (!this.active_item_id) return null;
    for (const day of this.journey_days) {
      const found = day.items.find(item => item.id === this.active_item_id);
      if (found) return found;
    }
    return null;
  }

  /**
   * 設定活躍項目
   */
  setActiveItem(dayId, itemId, itemType) {
    this.active_day_id = dayId;
    this.active_item_id = itemId;
    this.active_item_type = itemType;
  }

  // ==========================================
  // 5. JSON 序列化與反序列化 (100% 相容舊 Python 版)
  // ==========================================

  /**
   * 匯出旅程資料為 JSON 格式 (完全符合原 Python 儲存格式)
   */
  toJSON() {
    const favorite_models = this.favorite_places.map(p => ({
      place_name: p.place_name,
      place_nickname: p.place_nickname,
      place_lat: p.place_lat,
      place_lng: p.place_lng,
      place_address: p.place_address,
      place_types: p.place_types,
      place_opening_hours_str: p.place_opening_hours_str,
      place_id: p.place_id,
      place_note: p.place_note
    }));

    const journey_daily_frames = this.journey_days.map(day => {
      const items = day.items.map(item => {
        if (item.type === 'move') {
          return {
            model_type: 'move',
            model_move_way: item.move_way,
            model_budget: item.budget,
            model_currency: item.currency,
            model_note: item.note,
            placemodel_start: {
              place_nickname: item.placemodel_start.place_nickname,
              place_lat: item.placemodel_start.place_lat,
              place_lng: item.placemodel_start.place_lng,
              place_id: item.placemodel_start.place_id,
              date: item.placemodel_start.date,
              hour: Number(item.placemodel_start.hour),
              minute: Number(item.placemodel_start.minute),
              timezone: item.placemodel_start.timezone,
              icon: item.placemodel_start.place_icon
            },
            placemodel_end: {
              place_nickname: item.placemodel_end.place_nickname,
              place_lat: item.placemodel_end.place_lat,
              place_lng: item.placemodel_end.place_lng,
              place_id: item.placemodel_end.place_id,
              date: item.placemodel_end.date,
              hour: Number(item.placemodel_end.hour),
              minute: Number(item.placemodel_end.minute),
              timezone: item.placemodel_end.timezone,
              icon: item.placemodel_end.place_icon
            }
          };
        } else if (item.type === 'stay') {
          return {
            model_type: 'stay',
            model_budget: item.budget,
            model_currency: item.currency,
            model_note: item.note,
            placemodel_start: {
              place_nickname: item.placemodel_start.place_nickname,
              place_lat: item.placemodel_start.place_lat,
              place_lng: item.placemodel_start.place_lng,
              place_id: item.placemodel_start.place_id,
              date: item.placemodel_start.date,
              hour: Number(item.placemodel_start.hour),
              minute: Number(item.placemodel_start.minute),
              timezone: item.placemodel_start.timezone,
              icon: item.placemodel_start.place_icon
            },
            placemodel_end: {
              date: item.placemodel_end.date,
              hour: Number(item.placemodel_end.hour),
              minute: Number(item.placemodel_end.minute),
              timezone: item.placemodel_end.timezone
            }
          };
        } else if (item.type === 'path') {
          return {
            model_type: 'path',
            model_path_name: item.path_name,
            model_path_list: item.path_list,
            model_color: item.color,
            model_budget: item.budget,
            model_currency: item.currency,
            model_note: item.note,
            placemodel_start: {
              date: item.placemodel_start.date,
              hour: Number(item.placemodel_start.hour),
              minute: Number(item.placemodel_start.minute),
              timezone: item.placemodel_start.timezone
            },
            placemodel_end: {
              date: item.placemodel_end.date,
              hour: Number(item.placemodel_end.hour),
              minute: Number(item.placemodel_end.minute),
              timezone: item.placemodel_end.timezone
            }
          };
        }
      });

      return {
        journey_daily_date: day.date,
        items: items
      };
    });

    return {
      file_name: this.journey_name,
      favorite_models: favorite_models,
      journey_daily_frames: journey_daily_frames
    };
  }

  /**
   * 從 JSON 資料還原旅程 (相容舊版結構)
   */
  fromJSON(data) {
    if (!data) return;

    this.newJourney();
    this.journey_name = data.file_name || '';

    // 還原口袋名單
    if (Array.isArray(data.favorite_models)) {
      this.favorite_places = data.favorite_models.map(fm => new PlaceModel({
        place_name: fm.place_name,
        place_nickname: fm.place_nickname,
        place_lat: fm.place_lat,
        place_lng: fm.place_lng,
        place_address: fm.place_address,
        place_types: fm.place_types,
        place_opening_hours_str: fm.place_opening_hours_str,
        place_id: fm.place_id,
        place_note: fm.place_note,
        place_icon: CJ_CONSTANTS.DEFAULT_ICONS.FAVORITE
      }));
    }

    // 還原每日旅程
    if (Array.isArray(data.journey_daily_frames)) {
      this.journey_days = data.journey_daily_frames.map(frame => {
        const day = new JourneyDay({
          date: frame.journey_daily_date,
          show_on_map: true
        });

        if (Array.isArray(frame.items)) {
          day.items = frame.items.map(itemData => {
            if (itemData.model_type === 'move') {
              const start = new PlaceModel({
                place_nickname: itemData.placemodel_start?.place_nickname,
                place_lat: itemData.placemodel_start?.place_lat,
                place_lng: itemData.placemodel_start?.place_lng,
                place_id: itemData.placemodel_start?.place_id,
                date: itemData.placemodel_start?.date,
                hour: itemData.placemodel_start?.hour,
                minute: itemData.placemodel_start?.minute,
                timezone: itemData.placemodel_start?.timezone,
                place_icon: itemData.placemodel_start?.icon || '750'
              });

              const end = new PlaceModel({
                place_nickname: itemData.placemodel_end?.place_nickname,
                place_lat: itemData.placemodel_end?.place_lat,
                place_lng: itemData.placemodel_end?.place_lng,
                place_id: itemData.placemodel_end?.place_id,
                date: itemData.placemodel_end?.date,
                hour: itemData.placemodel_end?.hour,
                minute: itemData.placemodel_end?.minute,
                timezone: itemData.placemodel_end?.timezone,
                place_icon: itemData.placemodel_end?.icon || '750'
              });

              return new JourneyMoveModel(start, end, {
                move_way: itemData.model_move_way || '大眾運輸',
                budget: itemData.model_budget || '',
                currency: itemData.model_currency || 'NTD',
                note: itemData.model_note || ''
              });
            } else if (itemData.model_type === 'stay') {
              const start = new PlaceModel({
                place_nickname: itemData.placemodel_start?.place_nickname,
                place_lat: itemData.placemodel_start?.place_lat,
                place_lng: itemData.placemodel_start?.place_lng,
                place_id: itemData.placemodel_start?.place_id,
                date: itemData.placemodel_start?.date,
                hour: itemData.placemodel_start?.hour,
                minute: itemData.placemodel_start?.minute,
                timezone: itemData.placemodel_start?.timezone,
                place_icon: itemData.placemodel_start?.icon || '750'
              });

              const end = new PlaceModel({
                date: itemData.placemodel_end?.date,
                hour: itemData.placemodel_end?.hour,
                minute: itemData.placemodel_end?.minute,
                timezone: itemData.placemodel_end?.timezone
              });

              return new JourneyStayModel(start, end, {
                budget: itemData.model_budget || '',
                currency: itemData.model_currency || 'NTD',
                note: itemData.model_note || ''
              });
            } else if (itemData.model_type === 'path') {
              const start = new PlaceModel({
                date: itemData.placemodel_start?.date,
                hour: itemData.placemodel_start?.hour,
                minute: itemData.placemodel_start?.minute,
                timezone: itemData.placemodel_start?.timezone
              });

              const end = new PlaceModel({
                date: itemData.placemodel_end?.date,
                hour: itemData.placemodel_end?.hour,
                minute: itemData.placemodel_end?.minute,
                timezone: itemData.placemodel_end?.timezone
              });

              const pathModel = new JourneyPathModel(start, end, {
                path_name: itemData.model_path_name || '',
                path_list: itemData.model_path_list || [],
                color: itemData.model_color || '6',
                budget: itemData.model_budget || '',
                currency: itemData.model_currency || 'NTD',
                note: itemData.model_note || ''
              });
              pathModel.updateDistance(this.default_walk_velocity);
              return pathModel;
            }
          }).filter(Boolean);
        }

        return day;
      });
    }

    if (this.journey_days.length > 0) {
      this.active_day_id = this.journey_days[0].id;
    }
  }

  // ==========================================
  // 6. CSV 報表生成 (對應 maptoolframe.py 之 make_report)
  // ==========================================

  /**
   * 製作「旅程清單 Google 我的地圖匯入檔」CSV (WKT POINT / LINESTRING)
   */
  generateJourneyMapCSV() {
    const rows = [['WKT', '名稱', '說明']];

    for (const day of this.journey_days) {
      const dateStr = day.date ? day.date.slice(5) : ''; // 取 MM-DD

      for (const item of day.items) {
        if (item.type === 'move') {
          const s = item.placemodel_start;
          const e = item.placemodel_end;
          if (s.place_lat && s.place_lng) {
            rows.push([
              `POINT (${s.place_lng} ${s.place_lat})`,
              `${dateStr} ${s.place_nickname}`,
              s.place_note || ''
            ]);
          }
          if (e.place_lat && e.place_lng) {
            rows.push([
              `POINT (${e.place_lng} ${e.place_lat})`,
              `${dateStr} ${e.place_nickname}`,
              e.place_note || ''
            ]);
          }
        } else if (item.type === 'stay') {
          const s = item.placemodel_start;
          if (s.place_lat && s.place_lng) {
            rows.push([
              `POINT (${s.place_lng} ${s.place_lat})`,
              `${dateStr} ${s.place_nickname}`,
              s.place_note || ''
            ]);
          }
        } else if (item.type === 'path') {
          if (item.path_list && item.path_list.length > 1) {
            const linePoints = item.path_list.map(p => `${p[1]} ${p[0]}`).join(', ');
            rows.push([
              `LINESTRING (${linePoints})`,
              `${dateStr}  ${item.path_name}`,
              item.note || ''
            ]);
          }
        }
      }
    }

    return this._formatCSV(rows);
  }

  /**
   * 製作「口袋清單 Google 我的地圖匯入檔」CSV (WKT POINT)
   */
  generateFavoriteMapCSV() {
    const rows = [['WKT', '名稱', '說明']];

    for (const place of this.favorite_places) {
      if (place.place_lat && place.place_lng) {
        rows.push([
          `POINT (${place.place_lng} ${place.place_lat})`,
          place.place_nickname || place.place_name,
          place.place_note || ''
        ]);
      }
    }

    return this._formatCSV(rows);
  }

  /**
   * 製作「預算表」CSV (包含小計與總計)
   */
  generateBudgetCSV() {
    const rows = [['行程', '時間', '耗時(min)', '預算', '幣種', 'Note']];
    let grandTotal = 0;
    const currencyTotals = {};

    for (const day of this.journey_days) {
      const weekdayZH = CJUtils.getWeekdayZH(day.date);
      rows.push([`${day.date} (${weekdayZH})`, '', '', '', '', '']);

      let dayTotal = 0;
      for (const item of day.items) {
        let title = '';
        let timeStr = '';
        const duration = item.time_delta || 0;
        const budgetVal = parseFloat(item.budget) || 0;
        const currency = item.currency || this.default_currency;
        const note = item.note || '';

        dayTotal += budgetVal;
        grandTotal += budgetVal;
        currencyTotals[currency] = (currencyTotals[currency] || 0) + budgetVal;

        if (item.type === 'move') {
          title = `移動: ${item.placemodel_start.place_nickname} → ${item.placemodel_end.place_nickname} (${item.move_way})`;
          timeStr = `${String(item.placemodel_start.hour).padStart(2, '0')}:${String(item.placemodel_start.minute).padStart(2, '0')} - ${String(item.placemodel_end.hour).padStart(2, '0')}:${String(item.placemodel_end.minute).padStart(2, '0')}`;
        } else if (item.type === 'stay') {
          title = `停留: ${item.placemodel_start.place_nickname}`;
          timeStr = `${String(item.placemodel_start.hour).padStart(2, '0')}:${String(item.placemodel_start.minute).padStart(2, '0')} - ${String(item.placemodel_end.hour).padStart(2, '0')}:${String(item.placemodel_end.minute).padStart(2, '0')}`;
        } else if (item.type === 'path') {
          title = `路徑: ${item.path_name} (約 ${item.distance.toFixed(2)} km)`;
          timeStr = `${String(item.placemodel_start.hour).padStart(2, '0')}:${String(item.placemodel_start.minute).padStart(2, '0')} - ${String(item.placemodel_end.hour).padStart(2, '0')}:${String(item.placemodel_end.minute).padStart(2, '0')}`;
        }

        rows.push([
          title,
          timeStr,
          duration > 0 ? duration : '',
          item.budget || '',
          currency,
          note
        ]);
      }

      // 當日小計
      rows.push(['小計', '', '', dayTotal.toString(), '', '']);
      rows.push(['', '', '', '', '', '']); // 空行分隔
    }

    // 總結
    rows.push(['--- 總預算統計 ---', '', '', '', '', '']);
    for (const [cur, total] of Object.entries(currencyTotals)) {
      rows.push([`總額 (${cur})`, '', '', total.toString(), cur, '']);
    }

    return this._formatCSV(rows);
  }

  /**
   * 輔助函數：將二維陣列轉為加 BOM 的 CSV 字串 (確保 Excel 開啟不亂碼)
   */
  _formatCSV(rows) {
    const csvContent = rows.map(row => {
      return row.map(cell => {
        let str = cell === null || cell === undefined ? '' : String(cell);
        // 如果包含逗號、換行或引號，進行跳脫處理
        if (str.includes(',') || str.includes('\n') || str.includes('"')) {
          str = '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      }).join(',');
    }).join('\r\n');

    // UTF-8 BOM
    return '\uFEFF' + csvContent;
  }
}

// 導出全局實例與類型 (在瀏覽器環境掛載於 window)
window.CJ_CONSTANTS = CJ_CONSTANTS;
window.CJUtils = CJUtils;
window.PlaceModel = PlaceModel;
window.JourneyMoveModel = JourneyMoveModel;
window.JourneyStayModel = JourneyStayModel;
window.JourneyPathModel = JourneyPathModel;
window.JourneyDay = JourneyDay;
window.DataCenter = DataCenter;
