import type { Migration } from "./migrationTypes.js";
import { m1_addEnabledStores } from "./m1_addEnabledStores.js";
import { m2_addMaxAbsolutePrice } from "./m2_addMaxAbsolutePrice.js";
import { m3_addEnabledGames } from "./m3_addEnabledGames.js";
import { m4_trimSeenDiscounts } from "./m4_trimSeenDiscounts.js";
import { m5_backfillSeenDiscounts } from "./m5_backfillSeenDiscounts.js";
import { m6_backfillSeenUpdates } from "./m6_backfillSeenUpdates.js";
import { m7_dropLegacySeenFields } from "./m7_dropLegacySeenFields.js";
import { m8_moveAuditLogsIntoCollection } from "./m8_moveAuditLogsIntoCollection.js";
import { m9_moveConfigBackupsIntoCollection } from "./m9_moveConfigBackupsIntoCollection.js";
import { m10_moveSuggestedCommandsIntoCollection } from "./m10_moveSuggestedCommandsIntoCollection.js";
import { m11_moveYoutubeErrorsIntoCollection } from "./m11_moveYoutubeErrorsIntoCollection.js";
import { m12_moveDeadLettersIntoCollection } from "./m12_moveDeadLettersIntoCollection.js";
import { m13_backfillOutboxStatus } from "./m13_backfillOutboxStatus.js";

const ALL_MIGRATIONS: Migration[] = [
  m1_addEnabledStores,
  m2_addMaxAbsolutePrice,
  m3_addEnabledGames,
  m4_trimSeenDiscounts,
  m5_backfillSeenDiscounts,
  m6_backfillSeenUpdates,
  m7_dropLegacySeenFields,
  m8_moveAuditLogsIntoCollection,
  m9_moveConfigBackupsIntoCollection,
  m10_moveSuggestedCommandsIntoCollection,
  m11_moveYoutubeErrorsIntoCollection,
  m12_moveDeadLettersIntoCollection,
  m13_backfillOutboxStatus
];

export { ALL_MIGRATIONS };
