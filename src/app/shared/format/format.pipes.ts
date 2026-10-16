import { Pipe, PipeTransform } from '@angular/core';
import { formatCents, formatImbalance, formatVolume } from './display-format';

@Pipe({ name: 'cents' })
export class CentsPipe implements PipeTransform {
  transform(cents: number | null): string {
    return formatCents(cents);
  }
}

@Pipe({ name: 'volume' })
export class VolumePipe implements PipeTransform {
  transform(v: number): string {
    return formatVolume(v);
  }
}

@Pipe({ name: 'signedRatio' })
export class SignedRatioPipe implements PipeTransform {
  transform(x: number | null): string {
    return formatImbalance(x);
  }
}
