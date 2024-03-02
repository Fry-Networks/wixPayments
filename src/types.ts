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
  
  export interface Address {
    fullName: {
      firstName: string;
      lastName: string;
    };
    country: string;
    subdivision: string;
    city: string;
    zipCode: string;
    phone: string;
    email: string;
    addressLine1: string;
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
  
  export interface TrackingInfo {
    trackingNumber: string;
    shippingProvider: string;
  }
  
  export interface ShipmentDetails {
    address: Address;
    trackingInfo: TrackingInfo;
    discount: string;
    tax: string;
    priceData: {
      taxIncludedInPrice: boolean;
      price: string;
    };
  }
  
  export interface ShippingInfo {
    deliveryOption: string;
    shippingRegion: string;
    code: string;
    shipmentDetails: ShipmentDetails;
  }
  
  export interface LineItemOption {
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
  
  export interface LineItem {
    index: number;
    quantity: number;
    price: string;
    name: string;
    translatedName: string;
    productId: string;
    totalPrice: string;
    lineItemType: string;
    options: LineItemOption[];
    customTextFields: any[];
    mediaItem: MediaItem;
    variantId: string;
    discount: string;
    tax: string;
    taxIncludedInPrice: boolean;
    priceData: {
      taxIncludedInPrice: boolean;
      price: string;
      totalPrice: string;
    };
    refundedQuantity: number;
  }
  
  export interface Activity {
    type: string;
    timestamp: string;
  }
  
  export interface Coupon {
    couponId: string;
    name: string;
    code: string;
  }
  
  export interface Discount {
    value: string;
    appliedCoupon?: Coupon;
  }
  
  export interface Fulfillment {
    id: string;
    dateCreated: string;
    lineItems: {
      index: number;
      quantity: number;
    }[];
    trackingInfo: TrackingInfo;
  }
  
  export interface ChannelInfo {
    type: string;
  }
  
  export interface EnteredBy {
    id: string;
    identityType: string;
  }
  
  export interface Order {
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
    invoiceInfo: {
      id: string;
      source: string;
    };
    fulfillments: Fulfillment[];
    discount: Discount;
    cartId: string;
    buyerLanguage: string;
    channelInfo: ChannelInfo;
    enteredBy: EnteredBy;
    lastUpdated: string;
    numericId: string;
    refunds: any[];
    checkoutId: string;
    isInternalOrderCreate: boolean;
  }
  