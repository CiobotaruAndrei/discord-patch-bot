declare global {
  interface Object {
    notificationMode?: any;
    minDiscountPercent?: any;
    maxAbsolutePrice?: any;
    includeFreeGames?: any;
    includePaidDiscounts?: any;
    currency?: any;
    enabledStores?: any;
    pendingDiscounts?: any;
    content?: any;
    allowedMentions?: any;
    lastProcessedGameKey?: any;
  }

  const fetchGameStatus: any;
}

export {};
