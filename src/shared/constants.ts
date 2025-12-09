/**
 * Shared constants used across the extension
 */

/**
 * List of AGL middleware application names
 */
export const AGL_APPS = [
  'proxy', 
  'content', 
  'main', 
  'mediaroom', 
  'page-composition', 
  'user', 
  'plus', 
  'safetynet', 
  'recording', 
  'stub'
] as const;

export type AglApp = typeof AGL_APPS[number];

/**
 * List of AGL library names
 */
export const AGL_LIBS = [
  'agl-core', 
  'agl-logger', 
  'agl-utils', 
  'agl-gulp', 
  'agl-cache'
] as const;

export type AglLib = typeof AGL_LIBS[number];

/**
 * Preferred middleware loading order
 */
export const MIDDLEWARE_ORDER = [
  'page-composition', 
  'content', 
  'recording', 
  'proxy', 
  'plus', 
  'stub', 
  'mediaroom', 
  'user', 
  'main', 
  'safetynet'
] as const;

/**
 * Config file prefix for middleware configurations
 */
export const CONFIG_PREFIX = 'agl-config-';

/**
 * Middleware file prefix
 */
export const MIDDLEWARE_PREFIX = 'agl-';

/**
 * Middleware file suffix
 */
export const MIDDLEWARE_SUFFIX = '-middleware';
