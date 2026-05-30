export const epicFreeGamesFixture = {
  data: {
    Catalog: {
      searchStore: {
        elements: [
          {
            id: "epicgame1",
            title: "Free Epic Game",
            urlSlug: "free-epic-game",
            keyImages: [
              { type: "OfferImageWide", url: "https://cdn.epic/free-epic-game-wide.jpg" },
              { type: "Thumbnail", url: "https://cdn.epic/thumb.jpg" }
            ],
            price: { totalPrice: { originalPrice: 1999, discountPrice: 0 } },
            promotions: {
              promotionalOffers: [
                { promotionalOffers: [{ endDate: "2026-06-01T00:00:00.000Z" }] }
              ]
            }
          }
        ]
      }
    }
  }
};
