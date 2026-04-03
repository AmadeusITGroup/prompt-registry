/**
 * Fixture: Interface and concrete class where the class has extra methods
 * not in the interface.
 */
export interface IAdapter {
  readonly type: string;
  fetchData(): Promise<string[]>;
}

export class SpecialAdapter implements IAdapter {
  readonly type = 'special';

  public fetchData(): Promise<string[]> {
    return Promise.resolve([]);
  }

  public getSpecialName(): string {
    return 'special';
  }

  public getSpecialPath(): string {
    return '/special/path';
  }

  public trulyDead(): void {
    // never called — for control assertion
  }
}
