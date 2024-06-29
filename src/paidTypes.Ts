export interface OrderContainer {
  order: Order;
}

export interface Order {
  id: string;
  number: number;
  dateCreated: string;
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
  fulfillments: Fulfillment[];
  discount: Discount;
  buyerLanguage: string;
  channelInfo: ChannelInfo;
  enteredBy: EnteredBy;
  lastUpdated: string;
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
  address: Address;
  paidDate: string;
}

export interface ShippingInfo {
  deliveryOption: string;
  estimatedDeliveryTime: string;
  shippingRegion: string;
  shipmentDetails: ShipmentDetails;
}

export interface Address {
  fullName: FullName;
  country: string;
  city: string;
  zipCode: string;
  phone: string;
  email: string;
}

export interface FullName {
  firstName: string;
  lastName: string;
}

export interface ShipmentDetails {
  address: Address;
  discount: string;
  tax: string;
  priceData: PriceData;
}

export interface PriceData {
  taxIncludedInPrice: boolean;
  price: string;
}

export interface LineItem {
  index: number;
  quantity: number;
  name: string;
  productId: string;
  lineItemType: string;
  options: any[];
  customTextFields: any[];
  weight: string;
  sku: string;
  discount: string;
  tax: string;
  priceData: PriceData;
}

export interface Activity {
  type: string;
  timestamp: string;
}

export interface Fulfillment {}

export interface Discount {
  value: string;
}

export interface ChannelInfo {
  type: string;
}

export interface EnteredBy {
  id: string;
  identityType: string;
}
