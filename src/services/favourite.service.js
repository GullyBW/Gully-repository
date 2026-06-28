'use strict';

const domain = require('../domain/favourite');
const ProviderService = require('./provider.service');
const providerDomain = require('../domain/provider');
const { getFavouriteRepository } = require('../repositories');
const ApiError = require('../utils/ApiError');

/** Customers saving/removing/listing favourite providers. */
class FavouriteService {
  static get repo() {
    return getFavouriteRepository();
  }

  /** Save a provider as a favourite (idempotent). */
  static async add(actor, providerId) {
    const provider = await ProviderService.getRaw(providerId);
    if (!provider) throw ApiError.notFound('Provider not found');

    const existing = await FavouriteService.repo.find(actor.id, providerId);
    if (existing) return existing;

    return FavouriteService.repo.create(domain.createFavourite(actor.id, providerId));
  }

  static async remove(actor, providerId) {
    const removed = await FavouriteService.repo.remove(actor.id, providerId);
    return { removed };
  }

  /** List favourites, hydrated with provider card data for display. */
  static async list(actor) {
    const favourites = await FavouriteService.repo.listByCustomer(actor.id);
    const cards = [];
    for (const fav of favourites) {
      const provider = await ProviderService.getRaw(fav.providerId);
      if (provider) cards.push(providerDomain.toCardJSON(provider));
    }
    return cards;
  }

  static async isFavourite(actor, providerId) {
    const fav = await FavouriteService.repo.find(actor.id, providerId);
    return !!fav;
  }
}

module.exports = FavouriteService;
