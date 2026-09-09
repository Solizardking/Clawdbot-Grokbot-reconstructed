const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const base64 = value => typeof value === 'string' && value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
const formats = ['wav','mp3','flac','m4a','ogg','webm','aac'];
const ratios = ['1:1','3:4','4:3','9:16','16:9','2:3','3:2','9:19.5','19.5:9','9:20','20:9','1:2','2:1','auto'];
export function mediaRequest(path, body, user) {
  if (!object(body) || !user.models.includes(body.model)) return null;
  const allowed = path === '/images' ? ['model','prompt','aspect_ratio','resolution','quality']
    : path === '/audio/speech' ? ['model','input','voice','response_format']
    : path === '/audio/transcriptions' ? ['model','input_audio','language'] : [];
  if (!allowed.length || Object.keys(body).some(key => !allowed.includes(key))) return null;
  if (path === '/images') {
    if (!text(body.prompt,4096) || (body.aspect_ratio !== undefined && !ratios.includes(body.aspect_ratio)) || (body.resolution !== undefined && !['1K','2K'].includes(body.resolution)) || (body.quality !== undefined && !['low','medium'].includes(body.quality))) return null;
    return { ...body, n: 1 };
  }
  if (path === '/audio/speech') {
    if (!text(body.input,4096) || (body.voice !== undefined && (!text(body.voice,100) || !/^[a-zA-Z0-9_.-]+$/.test(body.voice))) || (body.response_format !== undefined && !['mp3','wav','pcm'].includes(body.response_format))) return null;
    return body;
  }
  if (!object(body.input_audio) || Object.keys(body.input_audio).some(k => !['data','format'].includes(k)) || !base64(body.input_audio.data) || body.input_audio.data.length > 8_000_000 || !formats.includes(body.input_audio.format) || (body.language !== undefined && !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(body.language))) return null;
  return body;
}

export async function mediaResponse(response, path) {
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 24_000_000) throw new Error('Media response too large');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (!bytes.length) throw new Error('Empty media response');
  if (path === '/audio/speech') {
    const type = response.headers.get('content-type')?.split(';')[0].trim();
    if (!['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/pcm','audio/L16','application/octet-stream'].includes(type)) throw new Error('Invalid speech response');
    return { bytes, type };
  }
  const payload = JSON.parse(bytes.toString('utf8'));
  if (!object(payload) || payload.error) throw new Error('Invalid media response');
  let result;
  if (path === '/audio/transcriptions') {
    if (typeof payload.text !== 'string') throw new Error('Missing transcript');
    result = { text: payload.text };
  } else {
    if (!Array.isArray(payload.data) || payload.data.length !== 1 || !base64(payload.data[0]?.b64_json)) throw new Error('Invalid generated image');
    const item = payload.data[0];
    if (item.media_type !== undefined && !['image/png','image/jpeg','image/webp'].includes(item.media_type)) throw new Error('Unsupported generated image type');
    result = { data: [{ b64_json: item.b64_json, ...(item.media_type === undefined ? {} : { media_type: item.media_type }) }] };
  }
  return { bytes: Buffer.from(JSON.stringify(result)), type: 'application/json' };
}
