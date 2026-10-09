export interface EncryptedProfile {
  version: 1;
  algorithm: 'AES-GCM';
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  iv: string;
  ciphertext: string;
}

const encoder = new TextEncoder();
const MAX_FILE_SIZE = 2_000_000;
const ITERATIONS = 600_000;

function base64(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseEncrypted(text: string): EncryptedProfile {
  if (text.length > MAX_FILE_SIZE) throw new Error('暗号化ファイルが大きすぎます。');
  try {
    const value: unknown = JSON.parse(text);
    if (!record(value) || !record(value.kdf)) throw new Error();
    const kdf = value.kdf;
    if (value.version !== 1 || value.algorithm !== 'AES-GCM' ||
        kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' ||
        typeof kdf.iterations !== 'number' || !Number.isInteger(kdf.iterations) ||
        kdf.iterations < 100_000 || kdf.iterations > 2_000_000 ||
        typeof kdf.salt !== 'string' || typeof value.iv !== 'string' ||
        typeof value.ciphertext !== 'string') throw new Error();
    if (bytes(kdf.salt).length !== 16 || bytes(value.iv).length !== 12 ||
        bytes(value.ciphertext).length < 16) throw new Error();
    return {
      version: 1, algorithm: 'AES-GCM',
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: kdf.iterations, salt: kdf.salt },
      iv: value.iv, ciphertext: value.ciphertext,
    };
  } catch {
    throw new Error('対応していない、または壊れた暗号化ファイルです。');
  }
}

async function deriveKey(password: string, kdf: EncryptedProfile['kdf']): Promise<CryptoKey> {
  const raw = encoder.encode(password);
  try {
    const material = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', iterations: kdf.iterations, salt: bytes(kdf.salt) },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
  } finally {
    raw.fill(0);
  }
}

function header(file: EncryptedProfile): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify({ version: file.version, algorithm: file.algorithm, kdf: file.kdf }));
}

export async function encryptProfile(plaintext: string, password: string): Promise<EncryptedProfile> {
  if (!password.length) throw new Error('パスワードを入力してください。');
  if (password.length > 1_024) throw new Error('パスワードが長すぎます。');
  const raw = encoder.encode(plaintext);
  if (raw.length > 1_000_000) throw new Error('データが大きすぎます。');
  const file: EncryptedProfile = {
    version: 1, algorithm: 'AES-GCM',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS,
      salt: base64(crypto.getRandomValues(new Uint8Array(16))) },
    iv: base64(crypto.getRandomValues(new Uint8Array(12))), ciphertext: '',
  };
  try {
    const key = await deriveKey(password, file.kdf);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: bytes(file.iv), additionalData: header(file), tagLength: 128 }, key, raw,
    );
    file.ciphertext = base64(new Uint8Array(encrypted));
    return file;
  } finally {
    raw.fill(0);
  }
}

export async function decryptProfile(file: EncryptedProfile, password: string): Promise<string> {
  if (password.length > 1_024) throw new Error('パスワードが長すぎます。');
  // Validate even callers that did not use parseEncrypted().
  const checked = parseEncrypted(JSON.stringify(file));
  let plaintext: ArrayBuffer | undefined;
  try {
    const key = await deriveKey(password, checked.kdf);
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(checked.iv), additionalData: header(checked), tagLength: 128 },
      key, bytes(checked.ciphertext),
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  } catch {
    throw new Error('復号できません。パスワード、またはファイルを確認してください。');
  } finally {
    if (plaintext) new Uint8Array(plaintext).fill(0);
  }
}
