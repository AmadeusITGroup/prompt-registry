/**
 * Fixture: Consumer that casts an adapter to `any` and uses typeof guard
 * before calling methods. The analyzer should detect these as valid call sites.
 */
import {
  IAdapter,
} from './adapter';

export class Registry {
  public async process(adapter: IAdapter): Promise<void> {
    if (adapter.type === 'special') {
      const specialAdapter = adapter as any;

      if (
        typeof specialAdapter.getSpecialName === 'function'
        && typeof specialAdapter.getSpecialPath === 'function'
      ) {
        const name = specialAdapter.getSpecialName();
        const path = specialAdapter.getSpecialPath();
        console.log(name, path);
      }
    }
  }
}
