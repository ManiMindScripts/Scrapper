export type AlertKind =
  | "ZERO_RESULTS"
  | "SOURCE_FAILED"
  | "VALIDATION_FAILURE";

export interface PipelineAlert {
  kind: AlertKind;
  sourceId: string;
  message: string;
  timestamp: string;
}

export class AlertManager {
  private alerts: PipelineAlert[] = [];

  record(kind: AlertKind, sourceId: string, message: string): PipelineAlert {
    const alert: PipelineAlert = {
      kind,
      sourceId,
      message,
      timestamp: new Date().toISOString(),
    };
    this.alerts.push(alert);
    return alert;
  }

  getAlerts(): PipelineAlert[] {
    return [...this.alerts];
  }

  hasAlerts(): boolean {
    return this.alerts.length > 0;
  }

  clear(): void {
    this.alerts = [];
  }
}
