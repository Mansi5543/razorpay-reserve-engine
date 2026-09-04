import {
  Product,
  Order,
  SEED_PRODUCTS,
  getProducts,
  getProductById,
  saveOrder,
  getOrderById,
  getOrderByRazorpayId,
  updateOrderStatus,
  decrementStock,
  resetStore
} from '../data/store.js';

export { Product, Order, SEED_PRODUCTS as INITIAL_PRODUCTS };

export class InventoryStore {
  public seed(): void {
    resetStore();
  }

  public getAllProducts(): Product[] {
    return getProducts();
  }

  public getProductById(id: string): Product | undefined {
    return getProductById(id);
  }

  public searchProducts(query?: string, maxBudgetPaise?: number): Product[] {
    let prods = getProducts(query);
    if (typeof maxBudgetPaise === 'number' && maxBudgetPaise > 0) {
      prods = prods.filter((p) => p.pricePaise <= maxBudgetPaise);
    }
    return prods;
  }

  public decrementStock(productId: string, quantity: number): boolean {
    return decrementStock(productId, quantity);
  }

  public createOrder(order: Order): Order {
    return saveOrder(order);
  }

  public getOrder(orderId: string): Order | undefined {
    return getOrderById(orderId);
  }

  public getOrderByRazorpayId(rzpOrderId: string): Order | undefined {
    return getOrderByRazorpayId(rzpOrderId);
  }

  public updateOrderStatus(
    orderId: string,
    status: Order['status'],
    razorpayPaymentId?: string
  ): Order | undefined {
    return updateOrderStatus(orderId, status, razorpayPaymentId);
  }
}

export const inventoryStore = new InventoryStore();
