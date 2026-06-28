'use strict';

const domain = require('../domain/savedAddress');
const { getSavedAddressRepository } = require('../repositories');
const ApiError = require('../utils/ApiError');

/** Customers' saved service locations (multiple per customer, one default). */
class SavedAddressService {
  static get repo() {
    return getSavedAddressRepository();
  }

  static async list(actor) {
    const items = await SavedAddressService.repo.listByCustomer(actor.id);
    return items.map(domain.toPublicJSON);
  }

  static async create(actor, input) {
    if (input.isDefault) await SavedAddressService.repo.clearDefault(actor.id);
    const addr = domain.createSavedAddress(actor.id, input);
    return domain.toPublicJSON(await SavedAddressService.repo.create(addr));
  }

  static async update(actor, id, input) {
    const addr = await SavedAddressService._owned(actor, id);
    if (input.isDefault) await SavedAddressService.repo.clearDefault(actor.id);
    domain.applyEdit(addr, input);
    return domain.toPublicJSON(await SavedAddressService.repo.save(addr));
  }

  static async remove(actor, id) {
    await SavedAddressService._owned(actor, id);
    const removed = await SavedAddressService.repo.remove(id);
    return { removed };
  }

  static async _owned(actor, id) {
    const addr = await SavedAddressService.repo.findById(id);
    if (!addr) throw ApiError.notFound('Address not found');
    if (addr.customerId !== actor.id) throw new ApiError(403, 'Not your address');
    return addr;
  }
}

module.exports = SavedAddressService;
