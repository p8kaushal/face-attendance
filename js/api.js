const API = {
  get baseUrl() {
      // const API_URL = 'https://att.konsoftech.in';
      const API_URL = 'http://localhost:3000';
    return (typeof window !== 'undefined' && window.API_URL) ? window.API_URL.replace(/\/+$/,'') : API_URL;
  },

  async request(endpoint, options = {}) {
    console.log(this.baseUrl, endpoint, options);
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
    return this.request('/api/me');
  },

  async getUsers() {
    return this.request('/api/users');
  },

  async createUser(userData) {
    return this.request('/api/users', { method: 'POST', body: JSON.stringify(userData) });
  },

  async deleteUser(id) {
    return this.request(`/api/users/${id}`, { method: 'DELETE' });
  },

  async getAttendance(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/attendance${query ? '?' + query : ''}`);
  },

  async recordAttendance(userId, type) {
    return this.request('/api/attendance/record', { method: 'POST', body: JSON.stringify({ userId, type }) });
  },

  async getUsersForAttendance() {
    return this.request('/api/attendance/users');
  },

  async exportAttendance() {
    return this.request('/api/attendance/export');
  },

  async localLogin(username, password) {
    return this.request('/auth/local/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  },

  async localRegister(username, password) {
    return this.request('/auth/local/register', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  }
};
