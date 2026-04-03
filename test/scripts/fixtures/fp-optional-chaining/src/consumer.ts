/**
 * Fixture: Consumer that calls Manager methods via optional chaining (`?.`).
 * The analyzer should detect these as valid call sites.
 */
import {
  Manager,
} from './manager';

export class App {
  private readonly manager: Manager | undefined;

  public async reset(): Promise<void> {
    await this.manager?.setActive(null);
    await this.manager?.deleteAllData();
  }
}
