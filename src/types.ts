export interface RootObject {
  entityId: string;
  slug: string;
  id: string;
  entityFqdn: string;
  updatedEvent: UpdatedEvent;
  eventTime: string;
  triggeredByAnonymizeRequest: boolean;
}

export interface UpdatedEvent {
  currentEntity: CurrentEntity;
}

export interface CurrentEntity {
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
