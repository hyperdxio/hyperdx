import logger from '@/utils/logger';

/**
 * Trims large data structures to prevent "Request Entity Too Large" errors
 * when multiple tool calls accumulate data in the conversation history.
 */
export function trimToolResponse(data: any, maxSize: number = 50000): any {
  const serialized = JSON.stringify(data);

  // If data is within acceptable size, return as-is
  if (serialized.length <= maxSize) {
    return data;
  }

  logger.warn(
    `Tool response too large, trimming data. Original Size: ${serialized.length}, Max Size: ${maxSize}`,
  );

  // Handle different data structures
  if (Array.isArray(data)) {
    return trimArray(data, maxSize);
  }

  if (typeof data === 'object' && data !== null) {
    return trimObject(data, maxSize);
  }

  return data;
}

function trimArray(arr: any[], maxSize: number): any[] {
  // Keep reducing array size until it fits
  let result = [...arr];
  let resultSize = JSON.stringify(result).length;

  while (resultSize > maxSize && result.length > 10) {
    // Keep at least 10 items
    const newLength = Math.max(10, Math.floor(result.length * 0.7));
    result = result.slice(0, newLength);
    resultSize = JSON.stringify(result).length;
  }

  if (result.length < arr.length) {
    logger.info(`Trimmed array from ${arr.length} to ${result.length} items`);
  }

  return result;
}

function trimObject(obj: any, maxSize: number): any {
  const result: any = {};
  let currentSize = 0;

  // Special handling for known structures
  if ('allFieldsWithKeys' in obj && 'keyValues' in obj) {
    // This is metadata from getAIMetadata
    result.allFieldsWithKeys = trimArray(
      obj.allFieldsWithKeys || [],
      maxSize * 0.6,
    );
    result.keyValues = trimObjectEntries(obj.keyValues || {}, maxSize * 0.4);

    // Include other properties if they exist
    for (const key in obj) {
      if (key !== 'allFieldsWithKeys' && key !== 'keyValues') {
        result[key] = obj[key];
      }
    }

    return result;
  }

  // Generic object trimming
  for (const [key, value] of Object.entries(obj)) {
    const valueStr = JSON.stringify(value);
    if (currentSize + valueStr.length > maxSize) {
      logger.info(`Trimming object, stopping at key: ${key}`);
      break;
    }
    result[key] = value;
    currentSize += valueStr.length;
  }

  return result;
}

function trimObjectEntries(obj: any, maxSize: number): any {
  const result: any = {};
  let currentSize = 0;
  let keyCount = 0;

  for (const [key, value] of Object.entries(obj)) {
    const entry = { [key]: value };
    const entrySize = JSON.stringify(entry).length;

    if (currentSize + entrySize > maxSize) {
      logger.info(
        `Trimmed keyValues from ${Object.keys(obj).length} to ${keyCount} entries`,
      );
      break;
    }

    result[key] = value;
    currentSize += entrySize;
    keyCount++;
  }

  return result;
}
