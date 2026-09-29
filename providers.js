const axios = require('axios');

const TIMEOUT = 15000;
const isHttpUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s.trim());

// Parse phản hồi có thể là JSON hoặc text thuần chứa link
function parseMaybeJson(raw) {
    if (typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch { return raw; }
}

function extractShortUrl(data, name) {
    if (typeof data === 'string') {
        if (isHttpUrl(data)) return data.trim();
    } else if (data) {
        const candidate =
            data.url || data.short_url || data.shortlink || data.link ||
            data.shortUrl || data.data?.url || data.result?.url || data.html;
        if (isHttpUrl(candidate)) return candidate.trim();
        if (data.status === 'error' || data.success === false) {
            throw new Error(data.message || `${name} không tạo được link`);
        }
    }
    throw new Error(`${name} không trả về link hợp lệ`);
}

const env = (k) => (process.env[k] || '').trim();

const PROVIDERS = {
    pcs: {
        id: 'pcs',
        name: 'PhienChoSo',
        description: 'Rút gọn qua PhienChoSo',
        isEnabled: () => !!env('PHIENCHOSO_API_TOKEN'),
        missing: 'PHIENCHOSO_API_TOKEN',
        async shorten(targetUrl) {
            const { data } = await axios.get('https://api.phienchoso.com/tukhoa-dev.php', {
                params: { token: env('PHIENCHOSO_API_TOKEN'), url: targetUrl, url_duphong: targetUrl },
                timeout: TIMEOUT
            });
            if (!data || data.status !== 'success' || !data.url) {
                throw new Error(data?.message || 'PhienChoSo không trả về link');
            }
            return data.url;
        }
    },

    layma: {
        id: 'layma',
        name: 'LayMa.net',
        description: 'Rút gọn qua LayMa.net',
        isEnabled: () => !!env('LAYMA_API_TOKEN'),
        missing: 'LAYMA_API_TOKEN',
        async shorten(targetUrl) {
            const { data } = await axios.get('https://api.layma.net/api/admin/shortlink/quicklink', {
                params: {
                    tokenUser: env('LAYMA_API_TOKEN'),
                    format: 'json',
                    url: targetUrl,
                    link_du_phong: env('LAYMA_FALLBACK_URL') || 'https://pastefy.app/xvIqsJ96/raw'
                },
                timeout: TIMEOUT
            });
            if (!data || data.success !== true || !data.html) throw new Error('LayMa.net không trả về link');
            return data.html;
        }
    },

    traffic68: {
        id: 'traffic68',
        name: 'Traffic68',
        description: 'Rút gọn qua Traffic68',
        isEnabled: () => !!env('TRAFFIC68_API_KEY'),
        missing: 'TRAFFIC68_API_KEY',
        async shorten(targetUrl) {
            const apiKey = env('TRAFFIC68_API_KEY');
            let response;
            try {
                response = await axios.get('https://traffic68.com/api/quicklink/api', {
                    params: { api: apiKey, url: targetUrl },
                    headers: { Authorization: `Bearer ${apiKey}` },
                    timeout: TIMEOUT,
                    responseType: 'text'
                });
            } catch (error) {
                const apiError = error.response?.data;
                let message = apiError;
                if (typeof apiError === 'string') {
                    try { message = JSON.parse(apiError).message || apiError; } catch { /* giữ nguyên text */ }
                } else if (apiError?.message) {
                    message = apiError.message;
                }
                throw new Error(message || error.message);
            }
            return extractShortUrl(parseMaybeJson(response.data), 'Traffic68');
        }
    },

    trafficvn: {
        id: 'trafficvn',
        name: 'TrafficVN',
        description: 'Rút gọn qua TrafficVN',
        isEnabled: () => !!env('TRAFFICVN_API_KEY'),
        missing: 'TRAFFICVN_API_KEY',
        async shorten(targetUrl) {
            const response = await axios.get('https://trafficvn.com/apidevelop', {
                params: {
                    api: env('TRAFFICVN_API_KEY'),
                    url: targetUrl,
                    fallback_url: env('TRAFFICVN_FALLBACK_URL') || 'https://example.com/expired'
                },
                timeout: TIMEOUT,
                responseType: 'text'
            });
            return extractShortUrl(parseMaybeJson(response.data), 'TrafficVN');
        }
    },

    link4m: {
        id: 'link4m',
        name: 'Link4m',
        description: 'Rút gọn qua Link4m',
        isEnabled: () => !!env('LINK4M_API_TOKEN'),
        missing: 'LINK4M_API_TOKEN',
        async shorten(targetUrl) {
            const { data } = await axios.get('https://link4m.co/api-shorten/v2', {
                params: { api: env('LINK4M_API_TOKEN'), url: targetUrl },
                timeout: TIMEOUT
            });
            if (data?.status !== 'success' || !data.shortenedUrl) {
                throw new Error(data?.message || 'Link4m không trả về link');
            }
            return data.shortenedUrl;
        }
    }
};

const enabledProviders = () => Object.values(PROVIDERS).filter(p => p.isEnabled());

module.exports = { PROVIDERS, enabledProviders };
