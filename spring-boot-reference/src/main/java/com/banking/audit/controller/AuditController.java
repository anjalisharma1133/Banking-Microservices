package com.banking.audit.controller;

import com.banking.audit.entity.AuditLog;
import com.banking.audit.repository.AuditLogRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/audit")
@ConditionalOnProperty(name = "spring.application.name", havingValue = "audit-service")
public class AuditController {

    @Autowired
    private AuditLogRepository auditLogRepository;

    @GetMapping("/logs")
    public List<AuditLog> getLogs() {
        // Return latest 50 logs using optimized repository query
        return auditLogRepository.findAllByOrderByTimestampDesc().stream()
                .limit(50)
                .toList();
    }

    @PostMapping("/logs")
    public AuditLog createLog(@RequestBody AuditLog log) {
        return auditLogRepository.save(log);
    }
}
