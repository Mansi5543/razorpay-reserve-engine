export interface Product {
  id: string;
  name: string;
  description: string;
  pricePaise: number;
  stock: number;
  category?: string;
}

export interface OrderItem {
  productId: string;
  quantity: number;
  pricePaise: number;
}

export interface Order {
  id: string;
  items: Array<{ productId: string; quantity: number; pricePaise: number }>;
  totalPaise: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  createdAt?: string;
}

export const SEED_PRODUCTS: Product[] = [
  {
    id: 'prod_mech_keyboard',
    name: 'Wireless Mechanical Keyboard',
    description: 'Compact 75% mechanical keyboard with tactile switches, hot-swappable sockets, and per-key RGB backlighting.',
    pricePaise: 649900, // ₹6,499
    stock: 25,
    category: 'Peripherals'
  },
  {
    id: 'prod_usbc_dock',
    name: '12-in-1 Dual 4K USB-C Docking Station',
    description: 'Universal USB-C dock with 100W Power Delivery pass-through, dual 4K HDMI, Gigabit Ethernet, and UHS-II SD reader.',
    pricePaise: 499900, // ₹4,999
    stock: 18,
    category: 'Accessories'
  },
  {
    id: 'prod_nc_headset',
    name: 'Wireless Noise-Canceling Headset',
    description: 'Over-ear Bluetooth headset with hybrid active noise cancellation, 40-hour battery life, and studio boom microphone.',
    pricePaise: 899900, // ₹8,999
    stock: 12,
    category: 'Audio'
  },
  {
    id: 'prod_4k_webcam',
    name: 'Ultra HD 4K Conference Webcam',
    description: '4K 60fps streaming webcam featuring AI auto-framing, dual stereo noise-canceling microphones, and privacy physical shutter.',
    pricePaise: 549900, // ₹5,499
    stock: 15,
    category: 'Video'
  },
  {
    id: 'prod_ergo_cushion',
    name: 'Memory Foam Ergonomic Seat Cushion',
    description: 'Orthopedic contoured memory foam seat cushion with cooling gel layer for coccyx support and posture relief.',
    pricePaise: 189900, // ₹1,899
    stock: 40,
    category: 'Ergonomics'
  },
  {
    id: 'prod_monitor_arm',
    name: 'Heavy-Duty Gas-Spring Dual Monitor Arm',
    description: 'Fully articulating dual monitor desk mount for screens up to 32 inches (9kg capacity each) with integrated cable channels.',
    pricePaise: 349900, // ₹3,499
    stock: 20,
    category: 'Ergonomics'
  },
  {
    id: 'prod_desk_pad',
    name: 'Extended Vegan Leather Desk Pad',
    description: 'Water-resistant, non-slip 90cm x 40cm dual-sided PU leather desk blotter mat for smooth mouse gliding.',
    pricePaise: 89900, // ₹899
    stock: 50,
    category: 'Accessories'
  },
  {
    id: 'prod_led_lamp',
    name: 'Smart Architectural LED Desk Lamp',
    description: 'Eye-care swing-arm clamp desk lamp with stepless dimming, 5 color temperatures (3000K-6000K), and auto shut-off timer.',
    pricePaise: 229900, // ₹2,299
    stock: 30,
    category: 'Lighting'
  }
];

// In-Memory Database
const productsMap = new Map<string, Product>();
const ordersMap = new Map<string, Order>();

export function resetStore(): void {
  productsMap.clear();
  ordersMap.clear();
  for (const item of SEED_PRODUCTS) {
    productsMap.set(item.id, { ...item });
  }
}

// Initialize seed data
resetStore();

export function getProducts(query?: string): Product[] {
  const all = Array.from(productsMap.values());
  if (!query || query.trim() === '') {
    return all.map((p) => ({ ...p }));
  }
  const q = query.toLowerCase().trim();
  return all
    .filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        (p.category && p.category.toLowerCase().includes(q))
    )
    .map((p) => ({ ...p }));
}

export function getProductById(id: string): Product | undefined {
  const prod = productsMap.get(id);
  return prod ? { ...prod } : undefined;
}

export function saveOrder(order: Order): Order {
  const saved: Order = {
    ...order,
    createdAt: order.createdAt || new Date().toISOString()
  };
  ordersMap.set(saved.id, saved);
  return { ...saved };
}

export function getOrderById(id: string): Order | undefined {
  const ord = ordersMap.get(id);
  return ord ? { ...ord } : undefined;
}

export function getOrderByRazorpayId(rzpOrderId: string): Order | undefined {
  for (const order of ordersMap.values()) {
    if (order.razorpayOrderId === rzpOrderId) {
      return { ...order };
    }
  }
  return undefined;
}

export function updateOrderStatus(
  orderId: string,
  status: Order['status'],
  razorpayPaymentId?: string
): Order | undefined {
  const order = ordersMap.get(orderId);
  if (!order) return undefined;
  order.status = status;
  if (razorpayPaymentId) {
    order.razorpayPaymentId = razorpayPaymentId;
  }
  return { ...order };
}

export function decrementStock(productId: string, quantity: number): boolean {
  const product = productsMap.get(productId);
  if (!product || product.stock < quantity) {
    return false;
  }
  product.stock -= quantity;
  return true;
}

// For backward-compatibility or class-like access
export class StoreService {
  getAllProducts() { return getProducts(); }
  getProductById(id: string) { return getProductById(id); }
  searchProducts(query?: string) { return getProducts(query); }
  decrementStock(id: string, qty: number) { return decrementStock(id, qty); }
  createOrder(order: Order) { return saveOrder(order); }
  getOrder(id: string) { return getOrderById(id); }
  getOrderByRazorpayId(id: string) { return getOrderByRazorpayId(id); }
  updateOrderStatus(id: string, status: Order['status'], rzpPaymentId?: string) {
    return updateOrderStatus(id, status, rzpPaymentId);
  }
  seed() { resetStore(); }
}

export const store = new StoreService();
