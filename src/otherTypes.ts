export interface OrderContainer {
  order: Order;
}

export interface Order {
  id: string;
  number: string;
  createdDate: string;
  updatedDate: string;
  lineItems: LineItem[];
  buyerInfo: BuyerInfo;
  paymentStatus: string;
  fulfillmentStatus: string;
  buyerLanguage: string;
  weightUnit: string;
  currency: string;
  taxIncludedInPrices: boolean;
  siteLanguage: string;
  priceSummary: PriceSummary;
  billingInfo: BillingInfo;
  shippingInfo: ShippingInfo;
  status: string;
  archived: boolean;
  taxSummary: TaxSummary;
  appliedDiscounts: AppliedDiscount[];
  activities: Activity[];
  attributionSource: string;
  createdBy: CreatedBy;
  channelInfo: ChannelInfo;
  checkoutId: string;
  customFields: CustomField[];
  cartId: string;
  isInternalOrderCreate: boolean;
  payNow: PayNow;
  balanceSummary: BalanceSummary;
  additionalFees: AdditionalFee[];
  purchaseFlowId: string;
  recipientInfo: RecipientInfo;
}

export interface LineItem {
  id: string;
  productName: ProductName;
  catalogReference: CatalogReference;
  quantity: number;
  totalDiscount: Amount;
  descriptionLines: DescriptionLine[];
  image: Image;
  physicalProperties: PhysicalProperties;
  itemType: ItemType;
  price: Amount;
  priceBeforeDiscounts: Amount;
  totalPriceBeforeTax: Amount;
  totalPriceAfterTax: Amount;
  paymentOption: string;
  taxDetails: TaxDetails;
  shippingGroupId: string;
  locations: any[];
  lineItemPrice: Amount;
  customLineItem: boolean;
}

export interface ProductName {
  original: string;
  translated: string;
}

export interface CatalogReference {
  catalogItemId: string;
  appId: string;
  options: CatalogOptions;
}

export interface CatalogOptions {
  options: Record<string, string>;
  variantId: string;
}

export interface Amount {
  amount: string;
  formattedAmount: string;
}

export interface DescriptionLine {
  name: ProductName;
  plainText: ProductName;
  lineType: string;
  plainTextValue: ProductName;
}

export interface Image {
  id: string;
  url: string;
  height: number;
  width: number;
}

export interface PhysicalProperties {
  sku: string;
  shippable: boolean;
}

export interface ItemType {
  preset: string;
}

export interface TaxDetails {
  taxableAmount: Amount;
  taxRate: string;
  totalTax: Amount;
}

export interface BuyerInfo {
  contactId: string;
  email: string;
  visitorId: string;
}

export interface PriceSummary {
  subtotal: Amount;
  shipping: Amount;
  tax: Amount;
  discount: Amount;
  totalPrice: Amount;
  total: Amount;
  totalWithGiftCard: Amount;
  totalWithoutGiftCard: Amount;
  totalAdditionalFees: Amount;
}

export interface BillingInfo {
  address: Address;
  contactDetails: ContactDetails;
}

export interface Address {
  country: string;
  subdivision: string;
  city: string;
  postalCode: string;
  addressLine: string;
  countryFullname: string;
  subdivisionFullname: string;
}

export interface ContactDetails {
  firstName: string;
  lastName: string;
  phone: string;
}

export interface ShippingInfo {
  carrierId: string;
  code: string;
  title: string;
  logistics: Logistics;
  cost: ShippingCost;
  region: Region;
}

export interface Logistics {
  deliveryTime: string;
  shippingDestination: ShippingDestination;
}

export interface ShippingDestination {
  address: Address;
  contactDetails: ContactDetails;
}

export interface ShippingCost {
  price: Amount;
  totalPriceBeforeTax: Amount;
  totalPriceAfterTax: Amount;
  taxDetails: TaxDetails;
}

export interface Region {
  name: string;
}

export interface TaxSummary {
  totalTax: Amount;
  manualTaxRate: string;
}

export interface AppliedDiscount {
  discountType: string;
  lineItemIds: string[];
  coupon: Coupon;
  id: string;
}

export interface Coupon {
  id: string;
  code: string;
  name: string;
  amount: Amount;
}

export interface Activity {
  id: string;
  createdDate: string;
  type: string;
}

export interface CreatedBy {}

export interface ChannelInfo {
  type: string;
}

export interface CustomField {}

export interface PayNow extends PriceSummary {}

export interface BalanceSummary {
  balance: Amount;
  paid: Amount;
  refunded: Amount;
}

export interface AdditionalFee {}

export interface RecipientInfo {
  address: Address;
  contactDetails: ContactDetails;
}
