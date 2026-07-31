import type { CommandHandler } from "../commandHandler.js";
import { DLC_HANDLER_KEYS } from "../../command-handlers/dlcInteractionHandler.js";
import { FUTURE_RELEASE_HANDLER_KEYS } from "../../command-handlers/futureReleaseInteractionHandler.js";
import { PRICE_ALERT_HANDLER_KEYS } from "../../command-handlers/priceAlertInteractionHandler.js";
import { SUBSCRIPTION_HANDLER_KEYS } from "../../command-handlers/subscriptionNotificationHandlers.js";
import { TEMPLATE_PREVIEW_HANDLER_KEYS } from "../../command-handlers/templateAndNotificationPreviewHandler.js";
import { YOUTUBE_HANDLER_KEYS } from "../../command-handlers/youtubeInteractionHandler.js";
import type { CommandDomainDeps } from "../commandDomainDeps.js";
import type { DefineDescriptor, AnyCommandHandlerDescriptor } from "../commandHandlerDescriptors.js";
import attachDlcInteractionHandler from "../../command-handlers/dlcInteractionHandler.js";
import attachFutureReleaseInteractionHandler from "../../command-handlers/futureReleaseInteractionHandler.js";
import attachPriceAlertInteractionHandler from "../../command-handlers/priceAlertInteractionHandler.js";
import attachSubscriptionNotificationHandlers from "../../command-handlers/subscriptionNotificationHandlers.js";
import attachTemplatePreviewHandler from "../../command-handlers/templateAndNotificationPreviewHandler.js";
import attachYouTubeInteractionHandler from "../../command-handlers/youtubeInteractionHandler.js";

export function notificationsDescriptors(
  define: DefineDescriptor
): readonly AnyCommandHandlerDescriptor[] {
  return [
    define({ id: "template-preview", needs: TEMPLATE_PREVIEW_HANDLER_KEYS, domain: "notifications", help: ["template preview", "notification preview"], build: context => attachTemplatePreviewHandler.buildCommandHandler(context) }),
    define({ id: "dlc", needs: DLC_HANDLER_KEYS, domain: "notifications", help: ["dlc"], build: context => attachDlcInteractionHandler.buildCommandHandler(context) }),
    define({ id: "price-alert", needs: PRICE_ALERT_HANDLER_KEYS, domain: "notifications", help: ["price-alert"], build: context => attachPriceAlertInteractionHandler.buildCommandHandler(context) }),
    define({ id: "future-release", needs: FUTURE_RELEASE_HANDLER_KEYS, domain: "notifications", help: ["future-release"], build: context => attachFutureReleaseInteractionHandler.buildCommandHandler(context) }),
    define({ id: "youtube", needs: YOUTUBE_HANDLER_KEYS, domain: "youtube", help: ["youtube"], build: context => attachYouTubeInteractionHandler.buildCommandHandler(context) }),
    define({ id: "subscription", needs: SUBSCRIPTION_HANDLER_KEYS, domain: "notifications", help: ["start", "stop"], build: context => attachSubscriptionNotificationHandlers.buildCommandHandler(context) }),
  ];
}
