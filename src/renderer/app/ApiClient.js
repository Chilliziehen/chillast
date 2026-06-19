// ApiClient.js — thin wrapper around the preload-exposed `window.mystApi`.
// It unwraps the `{ ok, data | error }` envelope so callers work with plain
// values and a thrown Error on failure, and centralises the bridge dependency
// so the rest of the renderer never touches `window.mystApi` directly.

const api = window.mystApi;

async function unwrap(promise) {
  const result = await promise;
  if (!result || result.ok !== true) {
    throw new Error((result && result.error) || '未知错误');
  }
  return result.data;
}

export const ApiClient = {
  getReferenceData: () => unwrap(api.getReferenceData()),
  getConfig: () => unwrap(api.getConfig()),
  getLocale: () => unwrap(api.getLocale()),
  getChartTypes: () => unwrap(api.getChartTypes()),
  searchCities: (query) => unwrap(api.searchCities(query)),
  computeChart: (request) => unwrap(api.computeChart(request)),

  profiles: {
    list: () => unwrap(api.profiles.list()),
    get: (id) => unwrap(api.profiles.get(id)),
    save: (profile) => unwrap(api.profiles.save(profile)),
    remove: (id) => unwrap(api.profiles.remove(id)),
  },

  chinese: {
    getReferenceData: () => unwrap(api.chinese.getReferenceData()),
    computeBazi: (profileData) => unwrap(api.chinese.computeBazi(profileData)),
    getSolarTerms: (year) => unwrap(api.chinese.getSolarTerms(year)),
    searchCities: (query) => unwrap(api.chinese.searchCities(query)),
  },
};
