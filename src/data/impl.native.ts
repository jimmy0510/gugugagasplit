import adapter from './repo.local.adapter';
import type { Repository } from './repository-types';

/** Android / iOS 端實作：本地 SQLite 優先 + 送出佇列。 */
const impl: Repository = adapter;

export default impl;
