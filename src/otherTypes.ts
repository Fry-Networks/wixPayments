export interface OrderDetails {
  id: string;
  number: number;
  dateCreated: string;
  buyerInfo: BuyerInfo;
  currency: string;
  weightUnit: string;
  totals: Totals;
  billingInfo: BillingInfo;
  shippingInfo: ShippingInfo;
  read: boolean;
  archived: boolean;
  paymentStatus: string;
  fulfillmentStatus: string;
  lineItems: LineItem[];
  activities: Activity[];
  invoiceInfo: InvoiceInfo;
  fulfillments: Fulfillment[];
  discount: Discount;
  cartId: string;
  buyerLanguage: string;
  channelInfo: ChannelInfo;
  enteredBy: EnteredBy;
  lastUpdated: string;
  numericId: string;
  refunds: any[]; // Assuming no specific structure was provided for refunds
  checkoutId: string;
  isInternalOrderCreate: boolean;
}

export interface BuyerInfo {
  id: string;
  type: string;
  identityType: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  contactId: string;
}

export interface Totals {
  subtotal: string;
  shipping: string;
  tax: string;
  discount: string;
  total: string;
  weight: string;
  quantity: number;
}

export interface BillingInfo {
  paymentMethod: string;
  externalTransactionId: string;
  paymentProviderTransactionId: string;
  paymentGatewayTransactionId: string;
  address: Address;
  paidDate: string;
  refundableByPaymentProvider: boolean;
}

export interface ShippingInfo {
  deliveryOption: string;
  shippingRegion: string;
  code: string;
  shipmentDetails: ShipmentDetails;
}

export interface Address {
  fullName: FullName;
  country: string;
  subdivision: string;
  phone: string;
  email: string;
  city?: string; // Optional if not present in all addresses
  zipCode?: string;
  addressLine1?: string;
  addressLine2?: string;
}

export interface FullName {
  firstName: string;
  lastName: string;
}

export interface ShipmentDetails {
  address: Address;
  trackingInfo: TrackingInfo;
  tax: string;
  priceData: PriceData;
}

export interface TrackingInfo {
  trackingNumber: string;
  shippingProvider: string;
  trackingLink: string;
}

export interface PriceData {
  taxIncludedInPrice: boolean;
  price: string;
}

export interface LineItem {
  index: number;
  quantity: number;
  price: string;
  name: string;
  translatedName: string;
  productId: string;
  totalPrice: string;
  lineItemType: string;
  options: Option[];
  customTextFields: any[]; // Assuming no specific structure was provided
  mediaItem: MediaItem;
  sku: string;
  variantId: string;
  discount: string;
  tax: string;
  taxIncludedInPrice: boolean;
  priceData: PriceData;
  fulfillerId?: string; // Optional if not present in all line items
}

export interface Option {
  option: string;
  selection: string;
}

export interface MediaItem {
  mediaType: string;
  url: string;
  width: number;
  height: number;
  mediaId: string;
  id: string;
}

export interface Activity {
  type: string;
  timestamp: string;
}

export interface InvoiceInfo {
  id: string;
  source: string;
}

export interface Fulfillment {
  id: string;
  dateCreated: string;
  lineItems: FulfillmentLineItem[];
  trackingInfo: TrackingInfo;
}

export interface FulfillmentLineItem {
  index: number;
  quantity: number;
}

export interface Discount {
  value: string;
  appliedCoupon: AppliedCoupon;
}

export interface AppliedCoupon {
  couponId: string;
  name: string;
  code: string;
}

export interface ChannelInfo {
  type: string;
}

export interface EnteredBy {
  id: string;
  identityType: string;
}
