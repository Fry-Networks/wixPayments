export interface OrderWithFulfillmentsContainer {
    orderWithFulfillments: OrderWithFulfillments;
  }
  
  export interface OrderWithFulfillments {
    orderId: string;
    fulfillments: Fulfillment[];
  }
  
  export interface Fulfillment {
    id: string;
    createdDate: string;
    lineItems: LineItem[];
    trackingInfo: TrackingInfo;
  }
  
  export interface LineItem {
    id: string;
    quantity: number;
  }
  
  export interface TrackingInfo {
    trackingNumber: string;
    shippingProvider: string;
    trackingLink: string;
  }
  