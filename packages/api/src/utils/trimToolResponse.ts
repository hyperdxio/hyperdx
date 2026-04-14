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

  // If we're still over budget (e.g. a single item exceeds maxSize), truncate
  // individual oversized items so the array itself stays within the limit.
  if (resultSize > maxSize) {
    result = result.map(item => {
      const itemStr = JSON.stringify(item);
      if (itemStr.length > maxSize) {
        logger.info(
          `Trimming oversized array item (${itemStr.length} bytes > ${maxSize} limit)`,
        );
        if (typeof item === 'object' && item !== null) {
          return trimObject(item, maxSize);
        }
        // Scalar that is itself too large — return a truncation marker
        return { __hdx_trimmed: true, originalSize: itemStr.length };
      }
      return item;
    });
  }

  if (result.length < arr.length) {
    logger.info(`Trimmed array from ${arr.length} to ${result.length} items`);
  }

  return result;
}

// Keys in trimObject come exclusively from Object.entries() on internal tool
// response data — never from user-supplied HTTP input — so bracket-notation
// writes are not an injection risk; see inline eslint-disable comments below.
function trimObject(obj: any, maxSize: number): any {
  const entries = Object.entries(obj);
  if (entries.length === 0) return obj;

  const result: any = {};

  // Give each key an equal share of the budget so that no single large value
  // crowds out the rest (e.g. a large array at key[0] eating all the budget
  // before key[1] gets a chance to appear).
  const perKeyBudget = Math.floor(maxSize / entries.length);
  let trimmed = false;

  for (const [key, value] of entries) {
    const valueStr = JSON.stringify(value);

    if (valueStr.length <= perKeyBudget) {
      result[key] = value; // eslint-disable-line security/detect-object-injection
    } else {
      logger.info(
        `Trimming oversized object value at key "${key}" (${valueStr.length} bytes > ${perKeyBudget} per-key budget)`,
      );
      if (Array.isArray(value)) {
        result[key] = trimArray(value, perKeyBudget); // eslint-disable-line security/detect-object-injection
      } else if (typeof value === 'object' && value !== null) {
        result[key] = trimObject(value, perKeyBudget); // eslint-disable-line security/detect-object-injection
      } else {
        result[key] = { __hdx_trimmed: true, originalSize: valueStr.length }; // eslint-disable-line security/detect-object-injection
      }
      trimmed = true;
    }
  }

  if (trimmed) {
    result.__hdx_trimmed = true;
  }

  return result;
}
