const API = {
  get baseUrl() {
    return (typeof window !== 'undefined') ? window.location.origin : '';
  },

  async request(endpoint, options = {}) {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options.headers }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  async getMe() {
    return this.request('/api/auth/me');
  },

  async getUsers() {
    return this.request('/api/users');
  },

  async createUser(userData) {
    return this.request('/api/users', { 
      method: 'POST', 
      body: JSON.stringify(userData) 
    });
  },

  async deleteUser(id) {
    return this.request(`/api/users/${id}`, { method: 'DELETE' });
  },

  async getAttendance(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/attendance${query ? '?' + query : ''}`);
  },

  /**
   * Post attendance checking request with backend ArcFace recognition
   */
  async recordAttendance(planarArray, qrToken = null, eventId = null, latitude = null, longitude = null, offlineUuid = null, timestamp = null) {
    return this.request('/api/attendance/record', {
      method: 'POST',
      body: JSON.stringify({ planarArray, qrToken, eventId, latitude, longitude, offlineUuid, timestamp })
    });
  },

  async exportAttendance() {
    return this.request('/api/attendance/export');
  },

  async localLogin(username, password) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  },

  async localRegister(username, password, role = 'attendee', employeeId = '', planarArray = [], imageData = null, name = '') {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, role, employeeId, planarArray, imageData, name })
    });
  },

  async localLogout() {
    return this.request('/api/auth/logout', { method: 'POST' });
  },

  // Events API
  async createEvent(eventData) {
    return this.request('/api/events', {
      method: 'POST',
      body: JSON.stringify(eventData)
    });
  },

  async getEvents() {
    return this.request('/api/events');
  },

  async generateEventQR(eventId, expiresInSeconds = 86400) {
    return this.request(`/api/events/${eventId}/qr`, {
      method: 'POST',
      body: JSON.stringify({ expiresInSeconds })
    });
  }
};

export default API;
