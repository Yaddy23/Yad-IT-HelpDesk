import { describe, expect, it } from 'vitest';

import { calculatePriority, DEFAULT_PRIORITY_MATRIX } from '../src/modules/settings/priorityMatrix.js';

describe('priority matrix calculation', () => {
  it('resolves the default matrix correctly', () => {
    expect(calculatePriority(DEFAULT_PRIORITY_MATRIX, 'high', 'high')).toBe('critical');
    expect(calculatePriority(DEFAULT_PRIORITY_MATRIX, 'high', 'medium')).toBe('high');
    expect(calculatePriority(DEFAULT_PRIORITY_MATRIX, 'medium', 'medium')).toBe('medium');
    expect(calculatePriority(DEFAULT_PRIORITY_MATRIX, 'low', 'low')).toBe('low');
    expect(calculatePriority(DEFAULT_PRIORITY_MATRIX, 'low', 'high')).toBe('medium');
  });

  it('falls back to medium on malformed config or unknown levels', () => {
    expect(calculatePriority(null, 'high', 'high')).toBe('medium');
    expect(calculatePriority({}, 'bogus', 'high')).toBe('medium');
    expect(calculatePriority(DEFAULT_PRIORITY_MATRIX, 'high', 'bogus')).toBe('medium');
  });
});
