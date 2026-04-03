export interface AISMessage {
  MessageType: string;
  MetaData: {
    MMSI: number;
    MMSI_String: string;
    ShipName: string;
    Latitude: number;
    Longitude: number;
    time_utc: string;
  };
  Message: {
    PositionReport?: {
      MessageID: number;
      UserID: number;
      Valid: boolean;
      NavigationalStatus: number;
      RateOfTurn: number;
      Sog: number;
      PositionAccuracy: boolean;
      Longitude: number;
      Latitude: number;
      Cog: number;
      TrueHeading: number;
      Timestamp: number;
    };
    ShipStaticData?: {
      MessageID: number;
      UserID: number;
      Valid: boolean;
      AisVersion: number;
      ImoNumber: number;
      CallSign: string;
      Name: string;
      Type: number;
      Dimension: { A: number; B: number; C: number; D: number };
      FixType: number;
      Eta: { Month: number; Day: number; Hour: number; Minute: number };
      MaximumStaticDraught: number;
      Destination: string;
    };
  };
}

export interface VesselState {
  mmsi: number;
  name: string;
  shipType: number;
  flag: string;
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  heading: number;
  navStatus: number;
  destination: string;
  draught: number;
  imo: number;
  lastUpdate: number;
  riskScore: number;
  zone: string | null;
}

export interface Zone {
  name: string;
  bounds: [[number, number], [number, number]]; // [[latMin, lonMin], [latMax, lonMax]]
}

export interface PriceUpdate {
  timestamp: string;
  symbol: string;
  price: number;
  currency: string;
  source: string;
}

export interface NewsEvent {
  id: string;
  title: string;
  url: string;
  source: string;
  domain: string;
  publishedAt: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentimentScore: number;
  keywords: string[];
}

export interface IntelligenceAlert {
  timestamp: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  evidence: string;
  resolved: boolean;
}

export interface ZoneStats {
  zone: string;
  zoneName: string;
  totalShips: number;
  tankerCount: number;
  avgSpeed: number;
  anchoredCount: number;
}

export interface WorkerMessage {
  type: 'vessel_update' | 'price_update' | 'news_update' | 'alert' | 'status';
  data: unknown;
}
