// 模拟 Refactor 代码变更
export class AppointmentService {
  async create(dto: any) {
    // 重构后的实现
    return { id: 1, status: 'created', ...dto };
  }
}
