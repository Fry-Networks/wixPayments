export interface RootObject {
  entityId: string;
  slug: string;
  id: string;
  entityFqdn: string;
  eventTime: string;
  actionEvent: ActionEvent;
  triggeredByAnonymizeRequest: boolean;
}

export interface ActionEvent {
  body: Body;
  previousFulfillmentStatus: string;
  newFulfillmentStatus: string;
  action: string;
}

export interface Body {
  order: Order;
}

export interface Order {
  number: string;
  additionalFees: any[];
  cartId: string;
  lineItems: LineItem[];
  paymentStatus: string;
  archived: boolean;
  seenByAHuman: boolean;
  activities: Activity[];
  appliedDiscounts: any[];
  customFields: any[];
  taxIncludedInPrices: boolean;
  attributionSource: string;
  weightUnit: string;
  priceSummary: PriceSummary;
  id: string;
  isInternalOrderCreate: boolean;
  status: string;
  billingInfo: BillingInfo;
  buyerInfo: BuyerInfo;
  payNow: PayNow;
  createdBy: CreatedBy;
  taxSummary: TaxSummary;
  currency: string;
  balanceSummary: BalanceSummary;
  updatedDate: string;
  checkoutId: string;
  buyerLanguage: string;
  channelInfo: ChannelInfo;
  fulfillmentStatus: string;
  createdDate: string;
}

export interface LineItem {
  physicalProperties: PhysicalProperties;
  quantity: number;
  paymentOption: string;
  image: Image;
  price: Price;
  totalPriceBeforeTax: Price;
  totalPriceAfterTax: Price;
  priceBeforeDiscounts: Price;
  totalDiscount: Price;
  id: string;
  itemType: ItemType;
  taxDetails: TaxDetails;
  productName: ProductName;
  descriptionLines: DescriptionLine[];
  catalogReference: CatalogReference;
  refundQuantity: number;
}

export interface PhysicalProperties {
  shippable: boolean;
}

export interface Image {
  id: string;
  url: string;
  height: number;
  width: number;
}

export interface Price {
  amount: string;
  formattedAmount: string;
}

export interface ItemType {
  preset: string;
}

export interface TaxDetails {
  taxableAmount: Price;
  taxRate: string;
  totalTax: Price;
}

export interface ProductName {
  original: string;
  translated: string;
}

export interface DescriptionLine {
  name: ProductName;
  plainText: ProductName;
  lineType: string;
  plainTextValue: ProductName;
}

export interface CatalogReference {
  catalogItemId: string;
  appId: string;
  options: CatalogOptions;
}

export interface CatalogOptions {
  currency: string;
  quantity: number;
  variantId: string;
}

export interface Activity {
  createdDate: string;
  type: string;
}

export interface PriceSummary {
  totalWithGiftCard: Price;
  totalAdditionalFees: Price;
  tax: Price;
  total: Price;
  totalPrice: Price;
  subtotal: Price;
  totalWithoutGiftCard: Price;
  discount: Price;
  shipping: Price;
}

export interface BillingInfo {
  address: Address;
  contactDetails: ContactDetails;
}

export interface Address {
  city: string;
  countryFullname: string;
  subdivisionFullname: string;
  addressLine: string;
  country: string;
  postalCode: string;
  subdivision: string;
}

export interface ContactDetails {
  firstName: string;
  lastName: string;
  phone: string;
}

export interface BuyerInfo {
  contactId: string;
  email: string;
  visitorId: string;
}

export interface PayNow {
  totalWithGiftCard: Price;
  tax: Price;
  total: Price;
  totalPrice: Price;
  subtotal: Price;
  totalWithoutGiftCard: Price;
  discount: Price;
  shipping: Price;
}

export interface CreatedBy {
  visitorId: string;
}

export interface TaxSummary {
  totalTax: Price;
}

export interface BalanceSummary {
  balance: Price;
}

export interface ChannelInfo {
  type: string;
}
