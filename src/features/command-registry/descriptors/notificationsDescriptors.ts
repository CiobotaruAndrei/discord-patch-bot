import type { CommandHandler } from "../commandHandler.js";
import type { CommandDomainDeps } from "../commandDomainDeps.js";
import type { CommandHandlerDomain, CommandHandlerDescriptor, AnyCommandHandlerDescriptor } from "../commandHandlerDescriptors.js";
import attachDlcInteractionHandler from "../../command-handlers/dlcInteractionHandler.js";
import attachFutureReleaseInteractionHandler from "../../command-handlers/futureReleaseInteractionHandler.js";
import attachPriceAlertInteractionHandler from "../../command-handlers/priceAlertInteractionHandler.js";
import attachSubscriptionNotificationHandlers from "../../command-handlers/subscriptionNotificationHandlers.js";
import attachTemplatePreviewHandler from "../../command-handlers/templateAndNotificationPreviewHandler.js";
import attachYouTubeInteractionHandler from "../../command-handlers/youtubeInteractionHandler.js";

export function notificationsDescriptors(
  define: <D extends CommandHandlerDomain>(
    input: { id: string; domain: D; build: (context: CommandDomainDeps[D]) => CommandHandler }
      & Partial<Pick<CommandHandlerDescriptor<D>, "scope" | "access" | "help" | "autocomplete">>
  ) => CommandHandlerDescriptor<D>
): readonly AnyCommandHandlerDescriptor[] {
  return [
    define({ id: "template-preview", domain: "notifications", help: ["template preview", "notification preview"], build: context => attachTemplatePreviewHandler.buildCommandHandler(context) }),
    define({ id: "dlc", domain: "notifications", help: ["dlc"], build: context => attachDlcInteractionHandler.buildCommandHandler(context) }),
    define({ id: "price-alert", domain: "notifications", help: ["price-alert"], build: context => attachPriceAlertInteractionHandler.buildCommandHandler(context) }),
    define({ id: "future-release", domain: "notifications", help: ["future-release"], build: context => attachFutureReleaseInteractionHandler.buildCommandHandler(context) }),
    define({ id: "youtube", domain: "youtube", help: ["youtube"], build: context => attachYouTubeInteractionHandler.buildCommandHandler(context) }),
    define({ id: "subscription", domain: "notifications", help: ["start", "stop"], build: context => attachSubscriptionNotificationHandlers.buildCommandHandler(context) }),
  ];
}
