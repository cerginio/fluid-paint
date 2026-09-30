'use strict';

const STORY_DEMO_BASE_URL = 'https://cdn.storytilecraft.cc/fluid-demo/';
const STORY_DEMO_INDEX_MAX_BYTES = 128 * 1024;
const STORY_DEMO_INDEX_MAX_STORIES = 200;
const STORY_DEMO_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const StoryDemoFileLoader = typeof module !== 'undefined' && module.exports
  ? require('./story-file-loader') : globalThis.StoryFileLoader;

class StoryDemoCatalog {
  constructor(fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch function is required.');
    this.fetchImpl = fetchImpl;
    this.index = null;
  }

  static validateIndex(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Demo index must be a JSON object.');
    }
    if (value.schemaVersion !== 1) throw new TypeError('Unsupported demo index schemaVersion.');
    if (!Array.isArray(value.stories) || value.stories.length > STORY_DEMO_INDEX_MAX_STORIES) {
      throw new TypeError('Demo index must contain at most 200 stories.');
    }
    if (value.generatedAt !== undefined && !StoryDemoCatalog._validDate(value.generatedAt)) {
      throw new TypeError('Demo index generatedAt is invalid.');
    }
    const slugs = new Set();
    const stories = value.stories.map((story, index) => {
      if (!story || typeof story !== 'object' || Array.isArray(story)) {
        throw new TypeError(`Demo entry ${index + 1} must be an object.`);
      }
      const { slug, title, frameCount, sizeBytes, credit, publishedAt } = story;
      if (typeof slug !== 'string' || slug.length > 80 || !STORY_DEMO_SLUG.test(slug) || slugs.has(slug)) {
        throw new TypeError(`Demo entry ${index + 1} has an invalid or duplicate slug.`);
      }
      if (typeof title !== 'string' || !title.trim()) {
        throw new TypeError(`Demo entry ${index + 1} has no title.`);
      }
      if (!Number.isSafeInteger(frameCount) || frameCount <= 0 ||
          !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
        throw new TypeError(`Demo entry ${index + 1} has invalid frameCount or sizeBytes.`);
      }
      if (typeof credit !== 'string' || !credit.trim()) {
        throw new TypeError(`Demo entry ${index + 1} has no credit.`);
      }
      if (!StoryDemoCatalog._validDate(publishedAt)) {
        throw new TypeError(`Demo entry ${index + 1} has an invalid publishedAt.`);
      }
      slugs.add(slug);
      return Object.freeze({ slug, title: title.trim(), frameCount, sizeBytes,
        credit: credit.trim(), publishedAt });
    });
    return Object.freeze({ schemaVersion: 1, generatedAt: value.generatedAt,
      stories: Object.freeze(stories) });
  }

  static _validDate(value) {
    if (typeof value !== 'string') return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match || !Number.isFinite(Date.parse(value))) return false;
    const [, year, month, day, hour, minute, second, zone] = match;
    if (+hour > 23 || +minute > 59 || +second > 59) return false;
    if (zone !== 'Z' && (+zone.slice(1, 3) > 23 || +zone.slice(4) > 59)) return false;
    const calendarDay = new Date(`${year}-${month}-${day}T00:00:00Z`);
    return calendarDay.getUTCFullYear() === +year &&
      calendarDay.getUTCMonth() + 1 === +month && calendarDay.getUTCDate() === +day;
  }

  async refreshIndex({ signal } = {}) {
    const response = await this.fetchImpl(`${STORY_DEMO_BASE_URL}index.json`, {
      method: 'GET', cache: 'no-cache', signal,
    });
    const { text } = await StoryDemoCatalog._readJson(response, STORY_DEMO_INDEX_MAX_BYTES);
    let value;
    try { value = JSON.parse(text); }
    catch (_) { throw new SyntaxError('Demo index is not valid JSON.'); }
    const validated = StoryDemoCatalog.validateIndex(value);
    this.index = validated;
    return validated;
  }

  async fetchStory(slug, { signal } = {}) {
    if (typeof slug !== 'string' || slug.length > 80 || !STORY_DEMO_SLUG.test(slug) ||
        !this.index?.stories.some((story) => story.slug === slug)) {
      throw new TypeError('Choose a story from the validated demo index.');
    }
    const response = await this.fetchImpl(`${STORY_DEMO_BASE_URL}${slug}.json`, {
      method: 'GET', signal,
    });
    const { text, byteSize } = await StoryDemoCatalog._readJson(response, StoryDemoFileLoader.MAX_BYTES);
    return StoryDemoFileLoader.parse(text, `${slug}.json`, byteSize);
  }

  static async _readJson(response, maxBytes) {
    if (!response || !response.ok) {
      throw new Error(`Demo request failed (HTTP ${response?.status ?? 'unknown'}).`);
    }
    const contentType = response.headers?.get('Content-Type') || '';
    if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|\s*$)/i.test(contentType)) {
      throw new TypeError('Demo response must have a JSON content type.');
    }
    const contentLength = response.headers?.get('Content-Length');
    if (contentLength !== null && contentLength !== undefined) {
      if (!/^\d+$/.test(contentLength.trim()) || Number(contentLength) > maxBytes) {
        throw new RangeError(`Demo response exceeds the ${maxBytes} byte limit or has an invalid length.`);
      }
    }
    if (!response.body || typeof response.body.getReader !== 'function') {
      throw new TypeError('Demo response does not support bounded streaming.');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let byteSize = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) throw new TypeError('Demo response stream is invalid.');
        byteSize += value.byteLength;
        if (byteSize > maxBytes) {
          await reader.cancel();
          throw new RangeError(`Demo response exceeds the ${maxBytes} byte limit.`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(byteSize);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), byteSize };
  }
}

StoryDemoCatalog.BASE_URL = STORY_DEMO_BASE_URL;
StoryDemoCatalog.INDEX_MAX_BYTES = STORY_DEMO_INDEX_MAX_BYTES;
StoryDemoCatalog.INDEX_MAX_STORIES = STORY_DEMO_INDEX_MAX_STORIES;

if (typeof module !== 'undefined' && module.exports) module.exports = StoryDemoCatalog;
if (typeof globalThis !== 'undefined') globalThis.StoryDemoCatalog = StoryDemoCatalog;
