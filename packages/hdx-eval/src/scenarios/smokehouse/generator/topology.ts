export const SERVICES = [
  'edge-gateway',
  'web-bff',
  'mobile-bff',
  'auth',
  'user-profile',
  'catalog',
  'search',
  'cart',
  'checkout',
  'orders',
  'recommendation',
  'review',
  'pricing',
  'promo',
  'inventory',
  'payment',
  'fraud',
  'shipping',
  'notification',
  'email-worker',
] as const;

export type Store = {
  system: 'postgresql' | 'redis' | 'elasticsearch' | 'http';
  name: string;
};
export type Call = {
  service: string;
  op: string;
  store?: Store;
  optional?: boolean;
  calls?: Call[];
};
export type Route = {
  method: string;
  path: string;
  weight: number;
  tree: (bff: string) => Call;
};

const pg = (name: string): Store => ({ system: 'postgresql', name });
const redis = (name: string): Store => ({ system: 'redis', name });
const es: Store = { system: 'elasticsearch', name: 'catalog-index' };
const gateway: Store = { system: 'http', name: 'payments.example.com' };

const pricing: Call = {
  service: 'pricing',
  op: 'pricing.quote',
  calls: [
    { service: 'pricing', op: 'redis.get', store: redis('price-cache') },
    { service: 'pricing', op: 'pg.select', store: pg('pricing-db') },
  ],
};
const catalog: Call = {
  service: 'catalog',
  op: 'catalog.get',
  calls: [{ service: 'catalog', op: 'pg.select', store: pg('catalog-db') }],
};
const auth: Call = {
  service: 'auth',
  op: 'auth.verify',
  calls: [{ service: 'auth', op: 'redis.get', store: redis('sessions') }],
};
const reco: Call = {
  service: 'recommendation',
  op: 'reco.for_user',
  optional: true,
  calls: [{ service: 'recommendation', op: 'pg.select', store: pg('reco-db') }],
};
const inventory: Call = {
  service: 'inventory',
  op: 'inventory.reserve',
  calls: [{ service: 'inventory', op: 'pg.update', store: pg('inventory-db') }],
};
const cart: Call = {
  service: 'cart',
  op: 'cart.get',
  calls: [
    { service: 'cart', op: 'redis.get', store: redis('carts') },
    { service: 'cart', op: 'pg.select', store: pg('cart-db') },
    inventory,
  ],
};
const orders: Call = {
  service: 'orders',
  op: 'orders.create',
  calls: [
    { service: 'orders', op: 'pg.insert', store: pg('orders-db') },
    {
      service: 'orders',
      op: 'orders.publish',
      calls: [
        {
          service: 'email-worker',
          op: 'orders.consume',
          calls: [
            {
              service: 'email-worker',
              op: 'smtp.send',
              store: { system: 'http', name: 'smtp.example.com' },
            },
          ],
        },
      ],
    },
  ],
};

const under = (bff: string, ...calls: Call[]): Call => ({
  service: 'edge-gateway',
  op: 'gateway.route',
  calls: [{ service: bff, op: `${bff}.handle`, calls: [auth, ...calls] }],
});

export const ROUTES: Route[] = [
  {
    method: 'GET',
    path: '/home',
    weight: 25,
    tree: bff => under(bff, catalog, reco),
  },
  {
    method: 'GET',
    path: '/search',
    weight: 20,
    tree: bff =>
      under(bff, {
        service: 'search',
        op: 'search.query',
        calls: [
          { service: 'search', op: 'es.search', store: es },
          catalog,
          pricing,
        ],
      }),
  },
  {
    method: 'GET',
    path: '/product/{id}',
    weight: 20,
    tree: bff =>
      under(bff, catalog, pricing, {
        service: 'review',
        op: 'review.list',
        optional: true,
        calls: [{ service: 'review', op: 'pg.select', store: pg('review-db') }],
      }),
  },
  {
    method: 'GET',
    path: '/cart',
    weight: 10,
    tree: bff => under(bff, cart, pricing),
  },
  {
    method: 'GET',
    path: '/profile',
    weight: 8,
    tree: bff =>
      under(bff, {
        service: 'user-profile',
        op: 'profile.get',
        calls: [
          { service: 'user-profile', op: 'pg.select', store: pg('users-db') },
        ],
      }),
  },
  {
    method: 'POST',
    path: '/checkout',
    weight: 10,
    tree: bff =>
      under(bff, {
        service: 'checkout',
        op: 'checkout.place',
        calls: [
          cart,
          pricing,
          {
            service: 'promo',
            op: 'promo.apply',
            calls: [
              { service: 'promo', op: 'pg.select', store: pg('promo-db') },
            ],
          },
          { service: 'fraud', op: 'fraud.score' },
          {
            service: 'payment',
            op: 'payment.charge',
            calls: [
              { service: 'payment', op: 'gateway.charge', store: gateway },
            ],
          },
          orders,
          { service: 'shipping', op: 'shipping.book' },
          { service: 'notification', op: 'notify.order', optional: true },
        ],
      }),
  },
  {
    method: 'GET',
    path: '/orders',
    weight: 7,
    tree: bff =>
      under(bff, {
        service: 'orders',
        op: 'orders.list',
        calls: [{ service: 'orders', op: 'pg.select', store: pg('orders-db') }],
      }),
  },
];

export function pods(service: string): string[] {
  return [1, 2, 3, 4, 5, 6].map(n => `${service}-${n}`);
}
