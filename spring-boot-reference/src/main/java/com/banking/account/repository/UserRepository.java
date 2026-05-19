package com.banking.account.repository;

import com.banking.account.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, String> {
    Optional<User> findByCustomerNumber(String customerNumber);
    Optional<User> findByEmail(String email);
    Optional<User> findByAccountNumber(String accountNumber);
    java.util.List<User> findByOwnerUid(String ownerUid);
    void deleteByOwnerUid(String ownerUid);
}
